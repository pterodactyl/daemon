'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2016 Dane Everitt <dane@daneeveritt.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const rfr = require('rfr');
const Dockerode = require('dockerode');
const isStream = require('isstream');
const Async = require('async');
const Util = require('util');
const _ = require('lodash');
const Carrier = require('carrier');

const Log = rfr('src/helpers/logger.js');
const Status = rfr('src/helpers/status.js');
const LoadConfig = rfr('src/helpers/config.js');
const ImageHelper = rfr('src/helpers/image.js');

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
        this.reattach(next);
    }

    reattach(next) {
        this.inspect((err, data) => {
            if (err) return next(err);
            // We kind of have to assume that if the server is running it is on
            // and not in the process of booting or stopping.
            if (!_.isUndefined(data.State.Running) && data.State.Running !== false) {
                this.server.setStatus(Status.ON);
                this.attach(attachErr => {
                    next(attachErr, (!attachErr));
                });
            } else {
                return next();
            }
        });
    }

    inspect(next) {
        this.container.inspect(next);
    }

    /**
     * Starts a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    start(next) {
        this.container.start(err => {
            // Container is already running, we can just continue on and pretend we started it just now.
            if (err && _.includes(err.message, 'container already started')) {
                this.server.setStatus(Status.ON);
                return next();
            } else if (err) {
                next(err);
            } else {
                this.server.setStatus(Status.STARTING);
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
        this.container.stop(next);
    }

    /**
     * Kills a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    kill(next) {
        this.container.kill(next);
    }

    /**
     * Pauses a running container and returns a callback when done.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    pause(next) {
        this.container.pause(next);
    }

    /**
     * Unpauses a running container and returns a callback when done.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    unpause(next) {
        this.container.unpause(next);
    }

    /**
     * Executes a command in the container requested.
     * @param  array    command
     * @param  function next
     * @return callback
     */
    exec(command, next) {
        // Check if we are already attached. If we don't do this then we encounter issues
        // where the daemon thinks the container is crashed even if it is not. This
        // is due to the exec() function calling steamClosed()
        if (isStream(this.stream)) {
            return next(new Error('An active stream is already in use for this container.'));
        }

        this.container.exec({ Cmd: command, AttachStdin: true, AttachStdout: true, Tty: true }, (err, exec) => {
            if (err) return next(err);
            exec.start((execErr, stream) => {
                if (!execErr && stream) {
                    stream.setEncoding('utf8');

                    // Sends data once EOL is reached.
                    Carrier.carry(this.stream, data => {
                        this.server.output(data);
                    });

                    stream.on('end', this.server.streamClosed());
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
            if (command === '^C') {
                return this.stop(next);
            }
            this.stream.write(`${command}\n`);
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
        // Check if we are currently running exec(). If we don't do this then we encounter issues
        // where the daemon thinks the container is crashed even if it is not. Mostly an issue
        // with exec(), but still worth checking out here.
        if (!_.isUndefined(this.stream) || isStream(this.stream)) {
            return next(new Error('An active stream is already in use for this container.'));
        }

        this.container.attach({ stream: true, stdin: true, stdout: true, stderr: true }, (err, stream) => {
            if (err) return next(err);
            this.stream = stream;
            this.stream.setEncoding('utf8');

            // Sends data once EOL is reached.
            Carrier.carry(this.stream, data => {
                this.server.output(data);
            });

            this.stream.on('end', () => {
                this.stream = undefined;
                this.server.streamClosed();
            });

            // Go ahead and setup the stats stream so we can pull data as needed.
            this.stats(next);
        });
    }

    /**
     * Returns a stream of process usage data for the container.
     * @param  {Function} next
     * @return {Callback}
     */
    stats(next) {
        this.container.stats({ stream: true }, (err, stream) => {
            if (err) return next(err);
            this.procStream = stream;
            this.procStream.setEncoding('utf8');
            Carrier.carry(this.procStream, data => {
                this.procData = (_.isObject(data)) ? data : JSON.parse(data);
            });
            this.procStream.on('end', function dockerTopSteamEnd() {
                this.procStream = undefined;
                this.procData = undefined;
            });
            return next();
        });
    }

    /**
     * Updates usage liits without requiring a rebuild.
     * @param  {Function} next
     * @return {Callback}
     */
    update(next) {
        // How Much Swap?
        let swapSpace = 0;
        if (this.server.json.build.swap < 0) {
            swapSpace = -1;
        } else if (this.server.json.build.swap > 0 && this.server.json.build.memory > 0) {
            swapSpace = ((this.server.json.build.memory + this.server.json.build.swap) * 1000000);
        }

        this.container.update({
            CpuQuota: (this.server.json.build.cpu > 0) ? (this.server.json.build.cpu * 1000) : -1,
            CpuPeriod: (this.server.json.build.cpu > 0) ? 100000 : 0,
            Memory: this.server.json.build.memory * 1000000,
            MemorySwap: swapSpace,
            BlkioWeight: this.server.json.build.io,
        }, next);
    }

    /**
     * Rebuilds a given servers container.
     * @param  {Function} next
     * @return {Callback}
     */
    rebuild(next) {
        const config = this.server.json.build;
        const bindings = {};
        const exposed = {};
        Async.series([
            callback => {
                // The default is to not automatically update images.
                if (!Config.get('docker.autoupdate_images', true)) {
                    ImageHelper.exists(config.image, err => {
                        if (!err) return callback();
                        Log.info(Util.format('Pulling image %s because it doesn\'t exist on the system.', config.image));
                        ImageHelper.pull(config.image, callback);
                    });
                } else {
                    Log.info(Util.format('Checking if we need to update image %s, if so it will happen now.', config.image));
                    ImageHelper.pull(config.image, callback);
                }
            },
            callback => {
                // Build the port bindings
                Async.forEachOf(config.ports, (ports, ip, eachCallback) => {
                    if (!_.isArray(ports)) return eachCallback();
                    Async.each(ports, (port, portCallback) => {
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
                    }, eachCallback);
                }, callback);
            },
            callback => {
                this.server.log.debug('Creating new container...');

                // Add some additional environment variables
                config.env.SERVER_MEMORY = config.memory;
                config.env.SERVER_IP = config.default.ip;
                config.env.SERVER_PORT = config.default.port;

                const environment = [];
                _.forEach(config.env, (value, index) => {
                    if (_.isNull(value)) return;
                    environment.push(Util.format('%s=%s', index, value));
                });

                // How Much Swap?
                let swapSpace = 0;
                if (config.swap < 0) {
                    swapSpace = -1;
                } else if (config.swap > 0 && config.memory > 0) {
                    swapSpace = ((config.memory + config.swap) * 1000000);
                }
                // Make the container
                DockerController.createContainer({
                    Image: config.image,
                    Hostname: 'container',
                    User: config.user.toString(),
                    AttachStdin: true,
                    AttachStdout: true,
                    AttachStderr: true,
                    OpenStdin: true,
                    Tty: true,
                    Mounts: [
                        {
                            Source: this.server.path(),
                            Destination: '/home/container',
                            RW: true,
                        },
                        {
                            Source: '/etc/timezone',
                            Destination: '/etc/timezone',
                            RW: false,
                        },
                    ],
                    Env: environment,
                    ExposedPorts: exposed,
                    HostConfig: {
                        Binds: [
                            Util.format('%s:/home/container', this.server.path()),
                            '/etc/timezone:/etc/timezone:ro',
                        ],
                        Tmpfs: {
                            '/tmp': '',
                        },
                        PortBindings: bindings,
                        OomKillDisable: config.oom_disabled || false,
                        CpuQuota: (config.cpu > 0) ? (config.cpu * 1000) : -1,
                        CpuPeriod: (config.cpu > 0) ? 100000 : 0,
                        Memory: config.memory * 1000000,
                        MemorySwap: swapSpace,
                        BlkioWeight: config.io,
                        Dns: Config.get('docker.dns', [
                            '8.8.8.8',
                            '8.8.4.4',
                        ]),
                        ExtraHosts: [
                            `container:${Config.get('docker.interface')}`,
                        ],
                        LogConfig: {
                            Type: 'none',
                        },
                        ReadonlyRootfs: true,
                        CapDrop: [
                            'setpcap',
                            'mknod',
                            'audit_write',
                            'chown',
                            'net_raw',
                            'dac_override',
                            'fowner',
                            'fsetid',
                            'kill',
                            'setgid',
                            'setuid',
                            'net_bind_service',
                            'sys_chroot',
                            'setfcap',
                        ],
                        NetworkMode: 'pterodactyl_nw',
                    },
                }, (err, container) => {
                    callback(err, container);
                });
            },
        ], (err, data) => {
            if (err) {
                return next(err);
            }
            this.server.log.debug('Removing old server container...');

            const newContainerInfo = {
                id: data[2].id,
                image: config.image,
            };

            this.container.inspect(inspectErr => {
                // if the inspection does not fail, the container exists
                if (!inspectErr) {
                    this.container.remove(removeError => {
                        next(removeError, newContainerInfo);
                    });
                // if it doesn't we'll just skip removal
                } else {
                    this.server.log.debug('Old container not found, skipping.');
                    next(null, newContainerInfo);
                }
            });
        });
    }
}

module.exports = Docker;
