'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const Dockerode = require('dockerode');
const isStream = require('isstream');
const Async = require('async');
const Util = require('util');
const _ = require('underscore');

const Status = rfr('src/helpers/status.js');
const LoadConfig = rfr('src/helpers/config.js');

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

class Docker {
    constructor(server, next) {
        this.server = server;
        this.containerID = this.server.json.container.id;
        this.container = DockerController.getContainer(this.containerID);
        this.stream = undefined;
        this.procStream = undefined;
        this.procData = undefined;

        // Check status and attach if server is running currently.
        this.reattach(function constructorDocker(err, status) {
            return next(err, status);
        });
    }

    reattach(next) {
        const self = this;
        this.inspect(function dockerReattach(err, data) {
            if (err) return next(err);
            // We kind of have to assume that if the server is running it is on
            // and not in the process of booting or stopping.
            if (typeof data.State.Running !== 'undefined' && data.State.Running !== false) {
                self.server.setStatus(Status.ON);
                self.attach(function (attachErr) {
                    return next(attachErr, (!attachErr));
                });
            } else {
                return next();
            }
        });
    }

    inspect(next) {
        this.container.inspect(function dockerInspect(err, data) {
            return next(err, data);
        });
    }

    /**
     * Starts a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    start(next) {
        const self = this;
        this.container.start(function dockerStart(err) {
            // Container is already running, we can just continue on and pretend we started it just now.
            if (err && err.message.indexOf('HTTP code is 304 which indicates error: container already started') > -1) {
                self.server.setStatus(Status.ON);
                return next();
            } else if (err) {
                next(err);
            } else {
                self.server.setStatus(Status.STARTING);
                return next();
            }
        });
    }

    /**
     * Stops a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    stop(next) {
        this.container.stop(function dockerStop(err) {
            return next(err);
        });
    }

    /**
     * Kills a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    kill(next) {
        this.container.kill(function (err) {
            return next(err);
        });
    }

    /**
     * Executes a command in the container requested.
     * @param  array    command
     * @param  function next
     * @return callback
     */
    exec(command, next) {
        const self = this;
        // Check if we are already attached. If we don't do this then we encounter issues
        // where the daemon thinks the container is crashed even if it is not. This
        // is due to the exec() function calling steamClosed()
        if (isStream(this.stream)) {
            return next(new Error('An active stream is already in use for this container.'));
        }

        this.container.exec({ Cmd: command, AttachStdin: true, AttachStdout: true, Tty: true }, function dockerExec(err, exec) {
            if (err) return next(err);
            exec.start(function dockerExecStartStart(execErr, stream) {
                if (!execErr && stream) {
                    stream.setEncoding('utf8');
                    stream.on('data', function dockerExecStreamData(data) {
                        // Send data to the Server.output() function.
                        self.server.output(data);
                    });
                    stream.on('end', function dockerExecStreamEnd() {
                        self.server.streamClosed();
                    });
                } else {
                    return next(execErr);
                }
            });
        });
    }

    /**
     * Writes input to the containers stdin.
     * @param  string   command
     * @param  {Function} next
     * @return {Callback}
     */
    write(command, next) {
        if (isStream.isWritable(this.stream)) {
            this.stream.write(command + '\n');
            return next();
        }
        return next(new Error('No writable stream was detected.'));
    }

    /**
     * Attaches to a container's stdin and stdout/stderr.
     * @param  {Function} next
     * @return {Callback}
     */
    attach(next) {
        const self = this;
        // Check if we are currently running exec(). If we don't do this then we encounter issues
        // where the daemon thinks the container is crashed even if it is not. Mostly an issue
        // with exec(), but still worth checking out here.
        if (typeof this.stream !== 'undefined' || isStream(this.stream)) {
            return next(new Error('An active stream is already in use for this container.'));
        }

        this.container.attach({ stream: true, stdin: true, stdout: true, stderr: true }, function dockerAttach(err, stream) {
            if (err) return next(err);
            self.stream = stream;
            self.stream.setEncoding('utf8');
            self.stream.on('data', function dockerAttachStreamData(data) {
                self.server.output(data);
            });
            self.stream.on('end', function dockerAttachStreamEnd() {
                self.stream = undefined;
                self.server.streamClosed();
            });

            // Go ahead and setup the stats stream so we can pull data as needed.
            self.stats(next);
        });
    }

    /**
     * Returns a stream of process usage data for the container.
     * @param  {Function} next
     * @return {Callback}
     */
    stats(next) {
        const self = this;
        this.container.stats({ stream: true }, function dockerTop(err, stream) {
            if (err) return next(err);
            self.procStream = stream;
            self.procStream.setEncoding('utf8');
            self.procStream.on('data', function dockerTopStreamData(data) {
                self.procData = JSON.parse(data);
            });
            self.procStream.on('end', function dockerTopSteamEnd() {
                self.procStream = undefined;
                self.procData = undefined;
            });
            return next();
        });
    }

    rebuild(next) {
        const self = this;
        const config = this.server.json.build;
        const bindings = {};
        const exposed = {};
        Async.series([
            function (callback) {
                // Build the port bindings
                Async.forEachOf(config.ports, function (ports, ip, eachCallback) {
                    if (!Array.isArray(ports)) return eachCallback();
                    Async.each(ports, function (port, portCallback) {
                        if (/^\d{1,6}$/.test(port) !== true) return portCallback();
                        bindings[Util.format('%s/tcp', port)] = [{
                            'HostIp': ip,
                            'HostPort': port.toString(),
                        }];
                        bindings[Util.format('%s/udp', port)] = [{
                            'HostIp': ip,
                            'HostPort': port.toString(),
                        }];
                        exposed[Util.format('%s/tcp', port)] = {};
                        exposed[Util.format('%s/udp', port)] = {};
                        portCallback();
                    }, function () {
                        eachCallback();
                    });
                }, function () {
                    return callback();
                });
            },
            function (callback) {
                self.server.log.debug('Removing server container...');
                self.container.remove(function (err) {
                    return callback(err);
                });
            },
            function (callback) {
                self.server.log.debug('Creating new container...');

                // Add some additional environment variables
                config.env.SERVER_MEMORY = config.memory;
                config.env.SERVER_IP = config.default.ip;
                config.env.SERVER_PORT = config.default.port;

                const environment = [];
                _.each(config.env, function (value, index) {
                    environment.push(Util.format('%s=%s', index, value));
                });

                // Make the container
                DockerController.createContainer({
                    Image: config.image,
                    Hostname: 'container',
                    User: config.user.toString(),
                    name: self.server.json.user,
                    AttachStdin: true,
                    AttachStdout: true,
                    AttachStderr: true,
                    OpenStdin: true,
                    Tty: true,
                    Mounts: [
                        {
                            Source: self.server.path(),
                            Destination: '/home/container',
                            RW: true,
                        },
                    ],
                    Env: environment,
                    ExposedPorts: exposed,
                    HostConfig: {
                        Binds: [
                            Util.format('%s:/home/container', self.server.path()),
                        ],
                        PortBindings: bindings,
                        OomKillDisable: config.oom_disabled || false,
                        CpuShares: (config.cpu * 1000),
                        CpuPeriod: (config.cpu > 0) ? 100000 : 0,
                        Memory: config.memory * 1000000,
                        BlkioWeight: config.io,
                        Dns: [
                            '8.8.8.8',
                            '8.8.4.4',
                        ],
                    },
                }, function (err, container) {
                    return callback(err, container);
                });
            },
        ], function (err, data) {
            if (err) {
                return next(err);
            }
            return next(null, {
                id: data[2].id,
                image: config.image,
            });
        });
    }
}

module.exports = Docker;
