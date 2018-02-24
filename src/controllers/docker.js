'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2017 Dane Everitt <dane@daneeveritt.com>.
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
const Streams = require('memory-streams');
const Ansi = require('ansi-escape-sequences');
const Moment = require('moment');

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
const CONST_LOWMEM_PCT = Config.get('docker.memory.low.percent', 0.085);
const CONST_STDMEM_PCT = Config.get('docker.memory.std.percent', 0.048);
const CONST_HIGHMEM_PCT = Config.get('docker.memory.high.percent', 0.014);

const CONST_LOWMEM = Config.get('docker.memory.low.value', 1024);
const CONST_STDMEM = Config.get('docker.memory.std.value', 10240);

class Docker {
    constructor(server, next) {
        this.server = server;
        this.containerID = _.get(this.server.json, 'container.id', null);
        this.container = DockerController.getContainer(this.containerID);
        this.stream = undefined;
        this.procStream = undefined;
        this.procData = undefined;

        // Check status and attach if server is running currently.
        this.reattach(next);
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
        if (isStream(this.stream)) {
            this.stream.end();
        }
        this.container.kill(next);
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

        this.container.attach({
            stream: true,
            stdin: true,
            stdout: true,
            stderr: true,
        }, (err, stream) => {
            if (err) return next(err);

            this.stream = stream;
            this.stream.setEncoding('utf8');

            if (!_.isNull(this.checkingThrottleInterval)) {
                clearInterval(this.checkingThrottleInterval);
                this.checkingThrottleInterval = null;
            }

            if (!_.isNull(this.checkingMessageInterval)) {
                clearInterval(this.checkingMessageInterval);
                this.checkingMessageInterval = null;
            }

            let ThrottledStream = new Streams.ReadableStream('');

            ThrottledStream.on('data', data => {
                this.server.output(data.toString());
            });

            let MessageBuffer = '';
            let ConsoleThrottleMessageSent = false;
            let ThrottleMessageCount = 0;
            let LastThrottleMessageTime = Moment().subtract(Config.get('internals.throttle.decay_seconds', 10), 'seconds');
            let ShouldCheckThrottle = true;

            this.stream
                .on('data', data => {
                    if (!ShouldCheckThrottle) {
                        return;
                    }

                    if (!Config.get('internals.throttle.enabled', true)) {
                        ThrottledStream.append(data);
                        return;
                    }

                    if (Buffer.byteLength(MessageBuffer, 'utf8') > Config.get('internals.throttle.bytes', 30720)) {
                        ShouldCheckThrottle = false;

                        if (ThrottleMessageCount >= Config.get('internals.throttle.kill_at_count', 5) && this.server.status !== Status.STOPPING) {
                            this.server.output(`${Ansi.style.red} [Pterodactyl Daemon] Your server is sending too much data, process is being killed.`);
                            this.server.log.warn('Server has triggered automatic kill due to excessive data output. Potential DoS attack.');
                            this.server.kill(() => {}); // eslint-disable-line
                        }

                        if (!ConsoleThrottleMessageSent) {
                            ThrottleMessageCount += 1;
                            ConsoleThrottleMessageSent = true;
                            LastThrottleMessageTime = Moment();
                            this.server.log.debug({ throttleCount: ThrottleMessageCount }, 'Server is being throttled due too too much data being passed through the console.');
                            this.server.output(`${Ansi.style.yellow} [Pterodactyl Daemon] This output is now being throttled due to output speed!`);
                        }
                    } else {
                        MessageBuffer += data;
                        ThrottledStream.append(data);
                    }
                })
                .on('end', () => {
                    this.stream = undefined;
                    ThrottledStream = undefined;

                    clearInterval(this.checkingThrottleInterval);
                    clearInterval(this.checkingMessageInterval);
                    this.checkingThrottleInterval = null;
                    this.checkingMessageInterval = null;

                    this.server.streamClosed();
                })
                .on('error', streamError => {
                    this.server.log.error(streamError);
                });

            this.checkingThrottleInterval = setInterval(() => {
                MessageBuffer = '';
                ShouldCheckThrottle = true;
            }, Config.get('internals.throttle.check_interval_ms', 100));

            this.checkingMessageInterval = setInterval(() => {
                ConsoleThrottleMessageSent = false;
                // Happened within 10 seconds of previous, increment the counter. Otherwise,
                // subtract a throttle down to 0.
                if (Moment(LastThrottleMessageTime).add(Config.get('internals.throttle.decay_seconds', 10), 'seconds').isBefore(Moment())) {
                    ThrottleMessageCount = ThrottleMessageCount === 0 ? 0 : ThrottleMessageCount - 1;
                }
            }, 5000);

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
        const config = this.server.json.build;

        const ContainerConfiguration = {
            BlkioWeight: config.io,
            CpuQuota: (config.cpu > 0) ? config.cpu * 1000 : -1,
            CpuPeriod: 100000,
            CpuShares: _.get(config, 'cpu_shares', 1024),
            Memory: this.hardlimit(config.memory) * 1000000,
            MemoryReservation: config.memory * 1000000,
            MemorySwap: -1,
        };

        if (config.swap >= 0) {
            ContainerConfiguration.MemorySwap = (this.hardlimit(config.memory) + config.swap) * 1000000;
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
                    ImageHelper.pull(config.image, callback);
                }
            },
            update_ports: callback => {
                // Build the port bindings
                Async.eachOf(config.ports, (ports, ip, eachCallback) => {
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
                        Memory: this.hardlimit(config.memory) * 1000000,
                        MemoryReservation: config.memory * 1000000,
                        MemorySwap: -1,
                        CpuQuota: (config.cpu > 0) ? config.cpu * 1000 : -1,
                        CpuPeriod: 100000,
                        CpuShares: _.get(config, 'cpu_shares', 1024),
                        BlkioWeight: config.io,
                        Dns: Config.get('docker.dns', ['8.8.8.8', '8.8.4.4']),
                        LogConfig: {
                            Type: Config.get('docker.policy.container.log_driver', 'none'),
                        },
                        SecurityOpt: Config.get('docker.policy.container.securityopts', ['no-new-privileges']),
                        ReadonlyRootfs: Config.get('docker.policy.container.readonly_root', true),
                        CapDrop: Config.get('docker.policy.container.cap_drop', [
                            'setpcap', 'mknod', 'audit_write', 'chown', 'net_raw',
                            'dac_override', 'fowner', 'fsetid', 'kill', 'setgid',
                            'setuid', 'net_bind_service', 'sys_chroot', 'setfcap',
                        ]),
                        NetworkMode: Config.get('docker.network.name', 'pterodactyl_nw'),
                        OomKillDisable: _.get(config, 'oom_disabled', false),
                    },
                };

                if (config.swap >= 0) {
                    Container.HostConfig.MemorySwap = (this.hardlimit(config.memory) + config.swap) * 1000000;
                }

                DockerController.createContainer(Container, (err, container) => {
                    callback(err, container);
                });
            }],
        }, (err, data) => {
            if (err) return next(err);
            return next(null, {
                id: data.create_container.id,
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
            if (!err) {
                this.container.remove(next);
            } else if (err && _.startsWith(_.get(err, 'json.message', 'error'), 'No such container')) { // no such container
                return next();
            } else {
                return next(err);
            }
        });
    }
}

module.exports = Docker;
