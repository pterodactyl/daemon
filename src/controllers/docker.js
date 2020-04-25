'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2020 Dane Everitt <dane@daneeveritt.com>.
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
const Fs = require('fs-extra');
const Ansi = require('ansi-escape-sequences');
const Moment = require('moment');
const Tail = require('tail').Tail;

const Log = rfr('src/helpers/logger.js');
const Status = rfr('src/helpers/status.js');
const LoadConfig = rfr('src/helpers/config.js');
const ImageHelper = rfr('src/helpers/image.js');

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

/**
 * These constants define the amount of additional memory
 * to allocate to the container to prevent OOM errors
 * when using {SERVER_MEMORY} in the startup line.
 */
const CONST_LOWMEM_PCT = Config.get('docker.memory.low.percent', 0.096);
const CONST_STDMEM_PCT = Config.get('docker.memory.std.percent', 0.054);
const CONST_HIGHMEM_PCT = Config.get('docker.memory.high.percent', 0.021);

const CONST_LOWMEM = Config.get('docker.memory.low.value', 1024);
const CONST_STDMEM = Config.get('docker.memory.std.value', 10240);

class Docker {
    constructor(server, next) {
        this.server = server;
        this.containerID = _.get(this.server.json, 'uuid', null);
        this.container = DockerController.getContainer(this.containerID);

        this.stream = undefined;
        this.procData = undefined;
        this.logStream = null;

        // Check status and attach if server is running currently.
        this.reattach().then(running => {
            next(null, running);
        }).catch(next);
    }

    hardlimit(memory) {
        if (memory < CONST_LOWMEM) {
            return memory + (memory * CONST_LOWMEM_PCT);
        } else if (memory >= CONST_LOWMEM && memory < CONST_STDMEM) {
            return memory + (memory * CONST_STDMEM_PCT);
        } else if (memory >= CONST_STDMEM) {
            return memory + (memory * CONST_HIGHMEM_PCT);
        }
        return memory;
    }

    /**
     * Reattach to a running docker container and reconfigure the log streams. Returns a promise value of true
     * if the container is actually running, or false if the container is stopped.
     *
     * @return {Promise<any>}
     */
    reattach() {
        return new Promise((resolve, reject) => {
            this.container.inspect().then(data => {
                if (!_.isUndefined(data.State.Running) && data.State.Running !== false) {
                    this.server.setStatus(Status.ON);

                    // Attach to the instance, and then connect to the logs and stats output.
                    Promise.all([
                        this.attach(),
                        this.readLogStream(),
                        this.stats(),
                    ]).then(() => {
                        resolve(true);
                    }).catch(reject);
                } else {
                    return resolve(false);
                }
            }).catch(reject);
        });
    }

    /**
     * Starts a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    start(next) {
        this.container.inspect().then(data => {
            // When a container is first created the log path is surprisingly not set. Because of this things
            // will die when attempting to setup the tail. To avoid this, set the path manually if there is no
            // path set.
            const logPath = data.LogPath.length > 0 ? data.LogPath : `/var/lib/docker/containers/${data.Id}/${data.Id}-json.log`;

            this.truncateLogs(logPath).then(() => {
                this.container.start().then(() => {
                    this.server.setStatus(Status.STARTING);

                    Promise.all([
                        this.attach(),
                        this.readLogStream(),
                        this.stats(),
                    ]).then(() => {
                        next();
                    }).catch(next);
                }).catch(err => {
                    if (err && _.includes(err.message, 'container already started')) {
                        this.server.setStatus(Status.ON);
                        return next();
                    }

                    next(err);
                });
            }).catch(next);
        }).catch(next);
    }

    /**
     * Stops a given container and returns a callback when finished.
     * @param  {Function} next
     * @return {Function}
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
        if (isStream(this.stream)) {
            this.stream.end();
        }
        this.container.kill(next);
    }


    /**
     * Stops a given container by sending the provided signal through the kill command.
     *
     * @param {String} signal
     * @return {Promise<any>}
     */
    stopWithSignal(signal = 'SIGKILL') {
        return this.container.kill({ signal });
    }

    /**
     * Writes a string to the containers STDIN.
     *
     * @param {String} command
     * @return {Promise<any>}
     */
    write(command) {
        return new Promise((resolve, reject) => {
            if (isStream.isWritable(this.stream)) {
                this.stream.write(`${command}\n`);

                return resolve();
            }

            return reject(new Error('No writable stream was detected when attempting to write a command.'));
        });
    }

    /**
     * Truncate the docker logs for a given server when it is started so that we know we will only have
     * the most recent boot cycle logs.
     *
     * @param {String} path
     * @return {Promise<any>}
     */
    truncateLogs(path) {
        return new Promise((resolve, reject) => {
            Fs.ensureFile(path, err => {
                if (err) {
                    reject(err);
                }

                Fs.truncate(path, 0, truncateError => {
                    if (truncateError) {
                        return reject(truncateError);
                    }

                    resolve();
                });
            });
        });
    }

    /**
     * Rather than attaching to a container and reading the stream output, connect to the container's
     * logs and use those as the console output. The container will still be attached to in order to
     * handle sending data and monitoring for crashes.
     *
     * However, because attaching takes some time, often we lose important error messages that can help
     * a user to understand why their server is crashing. By reading the logs we can avoid this problem
     * and get them all of the important context.
     *
     * @return {Promise<void>}
     */
    readLogStream() {
        return new Promise((resolve, reject) => {
            if (!_.isNull(this.logStream)) {
                this.logStream.unwatch();
                this.logStream = null;
            }

            this.container.inspect().then(inspection => {
                const logPath = inspection.LogPath.length > 0 ? inspection.LogPath : `/var/lib/docker/containers/${inspection.Id}/${inspection.Id}-json.log`;

                Fs.ensureFile(logPath).then(() => {
                    this.logStream = new Tail(logPath);

                    this.logStream.on('line', data => {
                        const j = JSON.parse(data.toString());
                        this.server.output(_.trim(j.log));
                    });

                    this.logStream.on('error', err => {
                        this.server.log.error(err);
                    });

                    resolve();
                });
            }).catch(reject);
        });
    }

    /**
     * Reads the last 'n' bytes of the server's log file.
     *
     * @param {Number} bytes
     * @return {Promise<any>}
     */
    readEndOfLog(bytes) {
        return new Promise((resolve, reject) => {
            this.container.inspect().then(inspection => {
                // When a container is first created the log path is surprisingly not set. Because of this things
                // will die when attempting to setup the tail. To avoid this, set the path manually if there is no
                // path set.
                const logPath = inspection.LogPath.length > 0 ? inspection.LogPath : `/var/lib/docker/containers/${inspection.Id}/${inspection.Id}-json.log`;

                Fs.stat(logPath, (err, stat) => {
                    if (err && err.code === 'ENOENT') {
                        return resolve('');
                    } else if (err) {
                        return reject(err);
                    }

                    let opts = {};
                    let lines = '';
                    if (stat.size > bytes) {
                        opts = {
                            start: (stat.size - bytes),
                            end: stat.size,
                        };
                    }

                    const ReadStream = Fs.createReadStream(logPath, opts);

                    ReadStream.on('data', data => {
                        _.forEach(_.split(data.toString(), /\r?\n/), line => {
                            try {
                                const j = JSON.parse(line);
                                lines += j.log;
                            } catch (e) {
                                // do nothing, JSON parse error because we caught the tail end of a line.
                            }
                        });
                    });

                    ReadStream.on('end', () => {
                        resolve(lines);
                    });
                });
            });
        });
    }

    /**
     * Attaches to a container's stdin and stdout/stderr.
     *
     * @return {Promise<any>}
     */
    attach() {
        return new Promise((resolve, reject) => {
            // Check if we are currently running exec(). If we don't do this then we encounter issues
            // where the daemon thinks the container is crashed even if it is not. Mostly an issue
            // with exec(), but still worth checking out here.
            if (!_.isUndefined(this.stream) || isStream(this.stream)) {
                return reject(new Error('An active stream is already in use for this container.'));
            }

            this.container.attach({
                stream: true,
                stdin: true,
                stdout: true,
                stderr: true,
            }).then(stream => {
                this.stream = stream;
                this.stream.setEncoding('utf8');

                let linesSent = 0;
                let throttleTriggerCount = 0;
                let throttleTriggered = false;

                const throttleEnabled = Config.get('internals.throttle.enabled', true);
                const lastThrottleTime = Moment().subtract(Config.get('internals.throttle.decay_seconds', 10), 'seconds');
                const maxLinesPerInterval = parseInt(Config.get('internals.throttle.line_limit', 1000), 10);
                const maximumThrottleTriggers = parseInt(Config.get('internals.throttle.kill_at_count', 5), 10);

                const checkInterval = setInterval(() => {
                    throttleTriggered = false;
                    linesSent = 0;
                }, Config.get('internals.throttle.check_interval_ms', 100));

                const decrementTriggerCountInterval = setInterval(() => {
                    // Happened within 10 seconds of previous, increment the counter. Otherwise,
                    // subtract a throttle down to 0.
                    if (Moment(lastThrottleTime).add(Config.get('internals.throttle.decay_seconds', 10), 'seconds').isBefore(Moment())) {
                        throttleTriggerCount = throttleTriggerCount === 0 ? 0 : throttleTriggerCount - 1;
                    }
                }, 5000);

                // In this case we're still using the logs to actually output contents, but we will use the
                // attached stream to monitor for excessive data sending.
                this.stream.on('data', data => {
                    if (!throttleEnabled || throttleTriggered) {
                        return;
                    }

                    const lines = _.split(data, /\r?\n/);
                    linesSent += (lines.length - 1);

                    // If we've suddenly gone over the trigger threshold send a message to the console and register
                    // that event. The trigger will be reset automatically by the check interval time.
                    if (linesSent > maxLinesPerInterval) {
                        throttleTriggered = true;
                        throttleTriggerCount += 1;

                        this.server.log.debug({ throttleTriggerCount }, 'Server has passed the throttle detection threshold. Penalizing server process.');
                        this.server.output(`${Ansi.style.yellow}[Pterodactyl Daemon] Your server is sending too much data too quickly! Automatic spam detection triggered.`);
                    }

                    // We've triggered it too many times now, kill the server because clearly something is not
                    // working correctly.
                    if (throttleTriggerCount > maximumThrottleTriggers) {
                        this.server.output(`${Ansi.style.red}[Pterodactyl Daemon] Your server is sending too much data, process is being killed.`);
                        this.server.log.warn('Server has triggered automatic kill due to excessive data output. Potential DoS attack.');
                        this.server.kill(() => {}); // eslint-disable-line
                    }
                }).on('end', () => {
                    this.stream = undefined;
                    this.server.streamClosed();

                    clearInterval(checkInterval);
                    clearInterval(decrementTriggerCountInterval);
                }).on('error', streamError => {
                    this.server.log.error(streamError);
                });

                resolve();
            }).catch(reject);
        });
    }

    /**
     * Returns a stream of process usage data for the container.
     *
     * @return {Promise<any>}
     */
    stats() {
        return this.container.stats({ stream: true }).then(stream => {
            stream.setEncoding('utf8');

            Carrier.carry(stream, data => {
                this.procData = (_.isObject(data)) ? data : JSON.parse(data);
            });

            stream.on('end', () => {
                this.procData = undefined;
            });
        });
    }

    /**
     * Updates usage liits without requiring a rebuild.
     * @param  {Function} next
     * @return {Callback}
     */
    update(next) {
        const config = this.server.json.build;

        const ContainerConfiguration = {
            BlkioWeight: config.io,
            CpuQuota: (config.cpu > 0) ? config.cpu * 1000 : -1,
            CpuPeriod: 100000,
            CpuShares: _.get(config, 'cpu_shares', 1024),
            Memory: Math.round(this.hardlimit(config.memory) * 1000000),
            MemoryReservation: Math.round(config.memory * 1000000),
            MemorySwap: -1,
        };

        if (config.swap >= 0) {
            ContainerConfiguration.MemorySwap = Math.round((this.hardlimit(config.memory) + config.swap) * 1000000);
        }

        this.container.update(ContainerConfiguration, next);
    }

    /**
     * Builds a new container for a server.
     * @param  {Function} next
     * @return {Callback}
     */
    build(next) {
        const config = this.server.json.build;
        const bindings = {};
        const exposed = {};
        const environment = [];
        Async.auto({
            create_data_folder: callback => {
                Fs.ensureDir(this.server.path(), callback);
            },
            update_images: callback => {
                // Skip local images.
                if (_.startsWith(config.image, '~')) {
                    Log.debug(Util.format('Skipping pull attempt for %s as it is marked as a local image.', _.trimStart(config.image, '~')));
                    return callback();
                }

                // The default is to not automatically update images.
                if (!Config.get('docker.autoupdate_images', true)) {
                    ImageHelper.exists(config.image, err => {
                        if (!err) return callback();
                        Log.info(Util.format('Pulling image %s because it doesn\'t exist on the system.', config.image));
                        ImageHelper.pull(config.image, callback);
                    });
                } else {
                    Log.info(Util.format('Checking if we need to update image %s, if so it will happen now.', config.image));
                    ImageHelper.pull(config.image, pullErr => {
                        if (pullErr) {
                            Log.error({
                                err: pullErr,
                                image: config.image,
                            }, 'Encountered an error while attempting to fetch a fresh image. Continuing with existing system image.');
                        }

                        return callback();
                    });
                }
            },
            update_ports: callback => {
                // Build the port bindings
                Async.eachOf(config.ports, (ports, ip, eachCallback) => {
                    if (!_.isArray(ports)) return eachCallback();
                    Async.each(ports, (port, portCallback) => {
                        if (/^\d{1,6}$/.test(port) !== true) return portCallback();
                        if(bindings[Util.format('%s/tcp', port)] == undefined) bindings[Util.format('%s/tcp', port)] = [];
                        bindings[Util.format('%s/tcp', port)].push({
                            'HostIp': ip,
                            'HostPort': port.toString(),
                        });
                        if(bindings[Util.format('%s/udp', port)] == undefined) bindings[Util.format('%s/udp', port)] = [];
                        bindings[Util.format('%s/udp', port)].push({
                            'HostIp': ip,
                            'HostPort': port.toString(),
                        });
                        exposed[Util.format('%s/tcp', port)] = {};
                        exposed[Util.format('%s/udp', port)] = {};
                        portCallback();
                    }, eachCallback);
                }, callback);
            },
            set_environment: callback => {
                config.env.SERVER_MEMORY = config.memory;
                config.env.SERVER_IP = config.default.ip;
                config.env.SERVER_PORT = config.default.port;
                Async.eachOf(config.env, (value, index, eachCallback) => {
                    if (_.isNull(value)) return eachCallback();
                    environment.push(Util.format('%s=%s', index, value));
                    return eachCallback();
                }, callback);
            },
            create_container: ['create_data_folder', 'update_images', 'update_ports', 'set_environment', (r, callback) => {
                this.server.log.debug('Creating new container...');

                if (_.get(config, 'image').length < 1) {
                    return callback(new Error('No docker image was passed to the script. Unable to create container!'));
                }

                // Make the container
                const Container = {
                    Image: _.trimStart(config.image, '~'),
                    name: this.server.json.uuid,
                    Hostname: Config.get('docker.network.hostname', this.server.json.uuid).toString(),
                    User: Config.get('docker.container.user', 1000).toString(),
                    AttachStdin: true,
                    AttachStdout: true,
                    AttachStderr: true,
                    OpenStdin: true,
                    Tty: true,
                    Env: environment,
                    ExposedPorts: exposed,
                    HostConfig: {
                        Mounts: [
                            {
                                Target: '/home/container',
                                Source: this.server.path(),
                                Type: 'bind',
                                ReadOnly: false,
                            },
                            {
                                Target: Config.get('docker.timezone_path'),
                                Source: Config.get('docker.timezone_path'),
                                Type: 'bind',
                                ReadOnly: true,
                            },
                        ],
                        Tmpfs: {
                            '/tmp': Config.get('docker.policy.container.tmpfs', 'rw,exec,nosuid,size=50M'),
                        },
                        PortBindings: bindings,
                        Memory: Math.round(this.hardlimit(config.memory) * 1000000),
                        MemoryReservation: Math.round(config.memory * 1000000),
                        MemorySwap: -1,
                        CpuQuota: (config.cpu > 0) ? config.cpu * 1000 : -1,
                        CpuPeriod: 100000,
                        CpuShares: _.get(config, 'cpu_shares', 1024),
                        BlkioWeight: config.io,
                        Dns: Config.get('docker.dns', ['8.8.8.8', '8.8.4.4']),
                        LogConfig: {
                            Type: 'json-file',
                            Config: {
                                'max-size': Config.get('docker.policy.container.log_opts.max_size', '5m'),
                                'max-file': Config.get('docker.policy.container.log_opts.max_files', '1'),
                            },
                        },
                        SecurityOpt: Config.get('docker.policy.container.securityopts', ['no-new-privileges']),
                        ReadonlyRootfs: Config.get('docker.policy.container.readonly_root', true),
                        CapDrop: Config.get('docker.policy.container.cap_drop', [
                            'setpcap', 'mknod', 'audit_write', 'net_raw', 'dac_override',
                            'fowner', 'fsetid', 'net_bind_service', 'sys_chroot', 'setfcap',
                        ]),
                        NetworkMode: Config.get('docker.network.name', 'pterodactyl_nw'),
                        OomKillDisable: _.get(config, 'oom_disabled', false),
                    },
                };

                if (config.swap >= 0) {
                    Container.HostConfig.MemorySwap = Math.round((this.hardlimit(config.memory) + config.swap) * 1000000);
                }

                DockerController.createContainer(Container, (err, container) => {
                    callback(err, container);
                });
            }],
        }, err => {
            if (err) return next(err);
            return next(null, {
                image: _.trimStart(config.image, '~'),
            });
        });
    }

    /**
     * Destroys a container for a server.
     */
    destroy(container, next) {
        const FindContainer = DockerController.getContainer(container);
        FindContainer.inspect(err => {
            if (!_.isNull(this.logStream)) {
                this.logStream.unwatch();
                this.logStream = null;
            }

            if (!err) {
                this.container.remove(next);
            } else if (err && _.startsWith(err.reason, 'no such container')) { // no such container
                this.server.log.debug({ container_id: container }, 'Attempting to remove a container that does not exist, continuing without error.');
                return next();
            } else {
                return next(err);
            }
        });
    }
}

module.exports = Docker;
