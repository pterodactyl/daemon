'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2018 Dane Everitt <dane@daneeveritt.com>.
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
const Async = require('async');
const moment = require('moment');
const _ = require('lodash');
const EventEmitter = require('events').EventEmitter;
const Querystring = require('querystring');
const Path = require('path');
const Fs = require('fs-extra');
const extendify = require('extendify');
const Ansi = require('ansi-escape-sequences');
const Request = require('request');
const Cache = require('memory-cache');

const Log = require('./../helpers/logger');
const Docker = require('./docker');
const Status = require('./../helpers/status');
const ConfigHelper = require('./../helpers/config');
const Websocket = require('./../http/socket').ServerSockets;
const UploadSocket = require('./../http/upload');
const PackSystem = require('./pack');
const FileSystem = require('./fs');
const OptionController = require('./option');
const ServiceCore = require('./../services/index');
const Errors = require('./../errors/index');

const Config = new ConfigHelper();

class Server extends EventEmitter {
    constructor(json, next) {
        super();

        this.status = Status.OFF;
        this.json = json;
        this.uuid = this.json.uuid;
        this.processData = {
            query: {},
            process: {},
        };

        this.intervals = {
            process: null,
            query: null,
        };

        this.shouldRestart = false;
        this.knownWrite = false;
        this.buildInProgress = false;
        this.configDataLocation = Path.join(__dirname, '../../config/servers/', this.uuid);
        this.configLocation = Path.join(this.configDataLocation, 'server.json');
        this.containerInitialized = false;

        this.blockBooting = false;
        this.currentDiskUsed = 0;
        this.log = Log.child({ server: this.uuid });
        this.lastCrash = undefined;
        this.fs = new FileSystem(this);
        this.service = new ServiceCore(this);

        Async.series([
            callback => {
                this.service.init().then(callback).catch(callback);
            },
            callback => {
                this.initContainer(err => {
                    if (err && err.code === 'PTDL_IMAGE_MISSING') {
                        this.log.error({ error: err }, 'Unable to initalize the server container due to a missing docker image.');
                    } else if (err) {
                        return callback(err);
                    }

                    return callback();
                });
            },
            callback => {
                this.pack = new PackSystem(this);
                this.socketIO = new Websocket(this).init();
                this.uploadSocket = new UploadSocket(this).init();
                this.option = new OptionController(this);

                // Check disk usage on construct and then check it every 30 seconds.
                this.diskUse(this);
                this.intervals.diskUse = setInterval(this.diskUse, Config.get('internals.disk_use_seconds', 30) * 1000, this);

                this.containerInitialized = true;
                return callback();
            },
        ], next);
    }

    initContainer(next) {
        this.docker = new Docker(this, (err, status) => {
            if (err && _.startsWith(_.get(err, 'json.message', 'error'), 'No such container')) {
                this.log.warn('Container was not found. Attempting to recreate it.');
                this.rebuild(rebuildErr => {
                    if (rebuildErr && !_.isUndefined(rebuildErr.statusCode)) {
                        if (_.startsWith(_.get(rebuildErr, 'json.message'), 'No such image')) {
                            rebuildErr.code = 'PTDL_IMAGE_MISSING'; // eslint-disable-line
                            return next(rebuildErr);
                        }
                    }

                    return next(rebuildErr);
                });
            } else {
                if (!err && status) {
                    this.log.info('Daemon detected that the server container is currently running, re-attaching to it now!');
                }
                return next(err);
            }
        });
    }

    isSuspended() {
        return (_.get(this.json, 'suspended', 0) === 1);
    }

    hasPermission(perm, token, next) {
        const tokenData = Cache.get(`auth:token:${token}`);
        if (_.isNull(tokenData)) {
            this.validateToken(token, (err, data) => {
                if (err) return next(err);

                if (_.get(data, 'server') !== this.uuid) {
                    return next(null, false, 'uuidDoesNotMatch');
                }

                Cache.put(`auth:token:${token}`, data, data.expires_at);

                return this.validatePermission(data, perm, next);
            });
        } else {
            return this.validatePermission(tokenData, perm, next);
        }
    }

    validatePermission(data, permission, next) {
        if (!_.isUndefined(permission)) {
            if (_.includes(data.permissions, permission) || _.includes(data.permissions, 's:*')) {
                // Check Suspension Status
                return next(null, !this.isSuspended(), 'isSuspended');
            }
        }
        return next(null, false, 'isUndefined');
    }

    validateToken(token, next) {
        Request.get({
            url: `${Config.get('remote.base')}/api/remote/authenticate/${token}`,
            headers: {
                'Accept': 'application/vnd.pterodactyl.v1+json',
                'Authorization': `Bearer ${Config.get('keys.0')}`,
            },
        }, (err, response, body) => {
            if (err) {
                return next(err);
            }

            if (response.statusCode === 404) {
                return next(null, {
                    expires: 0,
                    server: null,
                    permissions: [],
                });
            }

            if (response.statusCode !== 200) {
                this.log.warn({
                    responseCode: response.statusCode,
                    requestURL: `${Config.get('remote.base')}/api/remote/authenticate/[token hidden]`,
                }, 'An error was returned by the Panel while attempting to authenticate a server access token.');

                return next(new Error('Panel returned a non-200 response code while attempting to authenticate a token.'));
            }

            const data = JSON.parse(body);
            return next(null, {
                expires: _.get(data, 'data.attributes.expires_in'),
                server: _.get(data, 'data.id'),
                permissions: _.get(data, 'data.attributes.permissions'),
            });
        });
    }

    setPermissions(next) {
        this.log.debug('Setting correct ownership of server files.');
        this.fs.chown('/', next);
    }

    setStatus(status) {
        if (status === this.status) return;
        const inverted = _.invert(Status);

        // If a user starts their server and then tries to stop it before the server is done
        // it triggers a crash condition. This logic determines if the server status is set to
        // stopping, and if so, we prevent changing the status to starting or on. This allows the
        // server to not crash when we press stop before it is compeltely started.
        if (this.status === Status.STOPPING && (status === Status.ON || status === Status.STARTING)) {
            this.log.debug(`Recieved request to mark server as ${inverted[status]} but the server is currently marked as STOPPING.`);
            return;
        }

        // Handle Internal Tracking
        if (status === Status.ON || status === Status.STARTING) {
            if (_.isNull(this.intervals.process)) {
                // Go ahead and run since it will be a minute until it does anyways.
                // Only run if the container is all initialized and ready to go though.
                if (this.containerInitialized) {
                    setTimeout(this.diskUse, 2000, this);
                }

                this.intervals.process = setInterval(this.process, 2000, this);
            }
        } else if (status === Status.STOPPING || status === Status.OFF) {
            if (!_.isNull(this.intervals.process)) {
                // Server is stopping or stopped, lets clear the interval as well as any stored
                // information about the process. Lets also detach the stats stream.
                clearInterval(this.intervals.process);
                this.intervals.process = null;
                this.processData.process = {};
            }
        }

        switch (status) {
        case Status.OFF:
            this.emit('console', `${Ansi.style.cyan}[Pterodactyl Daemon] Server marked as ${Ansi.style.bold}OFF`);
            break;
        case Status.ON:
            this.emit('console', `${Ansi.style.cyan}[Pterodactyl Daemon] Server marked as ${Ansi.style.bold}ON`);
            break;
        case Status.STARTING:
            this.emit('console', `${Ansi.style.cyan}[Pterodactyl Daemon] Server marked as ${Ansi.style.bold}STARTING`);
            break;
        case Status.STOPPING:
            this.emit('console', `${Ansi.style.cyan}[Pterodactyl Daemon] Server marked as ${Ansi.style.bold}STOPPING`);
            break;
        default:
            break;
        }

        this.log.info(`Server status has been changed to ${inverted[status]}`);
        this.status = status;
        this.emit(`is:${inverted[status]}`);
        this.emit('status', status);
    }

    preflight(next) {
        // Return immediately if server is currently powered on.
        if (this.status !== Status.STARTING) {
            return next(new Error('Server must be in starting state to run preflight.'));
        }

        this.service.onPreflight().then(next).catch(err => {
            if (err instanceof Errors.FileParseError) {
                this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] Encountered an error while processing ${err.file} -- this could lead to issues running the server.`);
                this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] ${err.message}`);

                return next();
            }

            if (err instanceof Errors.NoEggConfigurationError) {
                this.emit('console', `${Ansi.style['bg-red']}${Ansi.style.white}[Pterodactyl Daemon] No server egg configuration could be located; aborting startup.`);
            }

            return next(err);
        });
    }

    start(next) {
        if (this.status !== Status.OFF) {
            return next(new Error('Server is already running.'));
        }

        if (this.blockBooting) {
            return next(new Error('Server cannot be started, booting is blocked due to pack or egg install.'));
        }

        // Set status early on to avoid super fast clickers
        this.setStatus(Status.STARTING);

        if (this.json.rebuild === true || this.buildInProgress === true) {
            if (this.buildInProgress !== true) {
                Async.waterfall([
                    callback => {
                        this.buildInProgress = true;
                        callback();
                    },
                    callback => {
                        this.emit('console', `${Ansi.style.cyan}[Pterodactyl Daemon] Your server container needs to be rebuilt. This should only take a few seconds, but could take a few minutes. You do not need to do anything else while this occurs. Your server will automatically continue with startup once this process is completed.`);
                        this.setStatus(Status.STOPPING);
                        this.setStatus(Status.OFF);
                        this.rebuild(callback);
                    },
                    callback => {
                        this.log.info('Completed rebuild process for server container.');
                        this.emit('console', `${Ansi.style.green}[Pterodactyl Daemon] Completed rebuild process for server. Server is now booting.`);
                        this.start(callback);
                    },
                ], err => {
                    if (err) {
                        this.setStatus(Status.OFF);
                        this.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] A fatal error was encountered booting this container.`);
                        this.buildInProgress = false;
                        this.log.error(err);
                    }
                });
            } else {
                this.emit('console', `${Ansi.style.cyan}[Pterodactyl Daemon] Please wait while your server is being rebuilt.`);
            }
            return next(new Error('Server is currently queued for a container rebuild. Your request has been accepted and will be processed once the rebuild is complete.'));
        }

        Async.series([
            callback => {
                this.log.debug('Checking size of server folder before booting.');
                this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] Checking size of server data directory...`);
                this.fs.size((err, size) => {
                    if (err) return callback(err);

                    // 10 MB overhead accounting.
                    const sizeInMb = Math.round(size / (1000 * 1000));
                    this.currentDiskUsed = sizeInMb;

                    if (this.json.build.disk > 0 && sizeInMb > this.json.build.disk) {
                        this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] Not enough disk space! ${sizeInMb}M / ${this.json.build.disk}M`);
                        return callback(new Error('There is not enough available disk space to start this server.'));
                    }

                    this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] Disk Usage: ${sizeInMb}M / ${this.json.build.disk}M`);
                    return callback();
                });
            },
            callback => {
                if (Config.get('internals.set_permissions_on_boot', true)) {
                    this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] Ensuring file permissions.`);
                    this.setPermissions(callback);
                } else {
                    return callback();
                }
            },
            callback => {
                this.log.debug('Initializing for boot sequence, running preflight checks.');
                this.emit('console', `${Ansi.style.green}[Pterodactyl Daemon] Running server preflight.`);
                this.preflight(callback);
            },
            callback => {
                this.emit('console', `${Ansi.style.green}[Pterodactyl Daemon] Starting server container.`);
                this.docker.start(callback);
            },
        ], err => {
            if (err) {
                this.setStatus(Status.OFF);

                if (err && _.startsWith(_.get(err, 'json.message', 'error'), 'No such container')) { // no such container
                    this.log.error('The container for this server could not be found. Trying to rebuild it.');
                    this.modifyConfig({ rebuild: true }, false, modifyError => {
                        if (modifyError) return this.log.error('Could not modify config.');
                        this.start(_.noop); // Ignore the callback as there is nowhere to send the errors to.
                    });
                    return next(new Error('Server container was not found and needs to be rebuilt. Your request has been accepted and will be processed once the rebuild is complete.'));
                }

                this.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] A fatal error was encountered while starting this server.`);
                this.log.error(err);
                return next(err);
            }

            return next();
        });
    }

    /**
     * Stop a server using the defined egg stop capabilities.
     *
     * @param {Function} next
     * @return {void|Function}
     */
    stop(next) {
        if (this.status === Status.OFF) {
            return next();
        }

        if (_.isUndefined(_.get(this.service, 'config.stop'))) {
            this.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] No stop configuration is defined for this egg.`);
            return next();
        }

        this.setStatus(Status.STOPPING);

        // So, technically docker sends a SIGTERM to the process when this is run.
        // This works out fine normally, however, there are times when a container might take
        // more than 10 seconds to gracefully stop, at which point docker resorts to sending
        // a SIGKILL, which, as you can imagine, isn't ideal for stopping a server.
        //
        // So, what we will do is send a stop command, and then sit there and wait
        // until the container stops because the process stopped, at which point the crash
        // detection will not fire since we set the status to STOPPING.
        const stopCommand = _.get(this.service, 'config.stop');

        // Maintain backwards compatability with old eggs that used ^C as a way of telling a container
        // to stop using docker's default stop setup.
        if (stopCommand === '^C') {
            this.docker.stop(next);

            return;
        }

        // If the stop command begins with a "^" we will interpret that as the desire to
        // send a specific signal to the container to stop the application.
        if (_.startsWith(stopCommand, '^')) {
            this.docker.stopWithSignal(_.replace(stopCommand, '^', '')).then(next).catch(next);

            return;
        }

        // Send the command to the instance to begin the shutdown procedures.
        this.docker.write(stopCommand).then(next).catch(next);
    }

    /**
     * Send a command to the server. If the command matches the stop argument, stop the server.
     *
     * @param {String} command
     * @return {Promise<any>}
     */
    command(command) {
        // If the server is offline don't attempt to send a command, it won't work...
        if (this.status === Status.OFF) {
            return new Promise(resolve => {
                resolve();
            });
        }

        // If this is the stop command, handle it correctly and pass it over to the
        // stop function to do things.
        if (command === _.get(this.service, 'config.stop')) {
            return new Promise((resolve, reject) => {
                this.stop(err => {
                    if (err) {
                        return reject(err);
                    }

                    resolve();
                });
            });
        }

        return this.docker.write(command);
    }

    kill(next) {
        if (this.status === Status.OFF) {
            return next(new Error('Server is already stopped.'));
        }

        this.setStatus(Status.STOPPING);
        this.docker.kill(err => {
            this.setStatus(Status.OFF);
            this.emit('console', `${Ansi.style['bg-red']}${Ansi.style.white}[Pterodactyl Daemon] Server marked as ${Ansi.style.bold}KILLED.`);
            return next(err);
        });
    }

    restart(next) {
        if (this.status !== Status.OFF) {
            this.shouldRestart = true;
            this.stop(next);
        } else {
            this.start(next);
        }
    }

    /**
     * Send output from server container to websocket.
     */
    output(output) {
        this.service.onConsole(output);
    }

    /**
     * Handle the server stream instance closing on us. Runs through to attempt to determine if this was
     * an expected closing, or if it was a sudden crash. If it was a crash, restart the server, otherwise
     * just continue with whatever process got us into this situation.
     */
    streamClosed() {
        if (this.status === Status.OFF || this.status === Status.STOPPING) {
            this.setStatus(Status.OFF);

            if (this.shouldRestart) {
                this.shouldRestart = false;
                this.start(err => {
                    if (err && !_.includes(err.message, 'Server is currently queued for a container rebuild') && !_.includes(err.message, 'Server container was not found and needs to be rebuilt.')) {
                        this.log.error(err);
                    }
                });
            }
            return;
        }

        // Mark the server as off at this point, we don't do any further checks about
        // the current status from here.
        this.setStatus(Status.OFF);

        // Inspect the instance to get the exit code results to display to the user and to determine
        // how we should handle this crash.
        this.docker.container.inspect().then(results => {
            const props = {
                ExitCode: results.State.ExitCode,
                OOMKilled: results.State.OOMKilled,
                Error: results.State.Error,
            };

            // If the server "crashed" with a normal exit code indicating that it was stopped successfully
            // don't force it to reboot. This can happen if a plugin stops the server for someone.
            if (!Config.get('internals.clean_exit_is_crash', true) && parseInt(props.ExitCode, 10) === 0 && !props.OOMKilled) {
                return;
            }

            // If crash detection is disabled for the server don't do anything.
            if (!_.get(this.json, 'container.crashDetection', true)) {
                this.log.warn(props, 'Server detected as entering a crashed state; crash handler is disabled; aborting reboot.');
                return;
            }

            this.emit('console', `${Ansi.style['bg-red']}${Ansi.style.white}[Pterodactyl Daemon] ---------- Detected server process in a crashed state! ----------`);
            this.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] Exit Code: ${Ansi.style.reset}${props.ExitCode}`);
            this.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] Out of Memory: ${Ansi.style.reset}${props.OOMKilled}`);
            this.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] Error Response: ${Ansi.style.reset}${props.Error}`);
            this.emit('crashed');

            if (moment.isMoment(this.lastCrash) && moment(this.lastCrash).add(60, 'seconds').isAfter(moment())) {
                this.setCrashTime();
                this.log.warn(props, 'Server detected as crashed but has crashed within the last 60 seconds; aborting reboot.');
                this.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] Aborting automatic reboot due to crash within the last 60 seconds.`);

                return;
            }

            this.log.warn(props, 'Server detected as crashed! Attempting server reboot.');
            this.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] Server process detected as entering a crashed state; rebooting.`);
            this.setCrashTime();

            this.start(err => {
                if (err) throw err;
            });
        }).catch(this.log.fatal);
    }

    /**
     * Set the last time that the server crashed.
     */
    setCrashTime() {
        this.lastCrash = moment();
    }

    path(location) {
        const dataPath = Path.join(Config.get('sftp.path', '/srv/daemon-data'), this.json.uuid);

        let returnPath = dataPath;
        if (!_.isUndefined(location) && _.replace(location, /\s+/g, '').length > 0) {
            returnPath = Path.join(dataPath, Path.normalize(Querystring.unescape(location)));
        }

        // Path is good, return it.
        if (_.startsWith(returnPath, dataPath)) {
            return returnPath;
        }

        return dataPath;
    }

    // Still using self here because of intervals.
    query() {
        return _.noop();
    }

    diskUse(self) { // eslint-disable-line
        self.fs.size((err, size) => {
            if (err) return self.log.warn(err);

            self.currentDiskUsed = Math.round(size / (1000 * 1000)); // eslint-disable-line
            if (self.json.build.disk > 0 && size > (self.json.build.disk * 1000 * 1000) && self.status !== Status.OFF) {
                self.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] Server is violating disk space limits. Stopping process.`);

                if (Config.get('actions.disk.kill', true)) {
                    self.kill(killErr => {
                        if (killErr) self.log.error(killErr);
                    });
                } else {
                    self.stop(stopErr => {
                        if (stopErr) self.log.error(stopErr);
                    });
                }
            }
        });
    }

    process(self) { // eslint-disable-line
        if (self.status === Status.OFF) return;

        // When the server is started a stream of process data is begun
        // which is stored in Docker.procData. We wilol now access that
        // and process it.
        if (_.isUndefined(self.docker.procData)) return;

        // We need previous cycle information as well.
        if (_.isUndefined(self.docker.procData.precpu_stats.cpu_usage)) return;

        // This sometimes doesn't exist, possibly due to another race condition?
        if (_.isUndefined(self.docker.procData.cpu_stats.cpu_usage.percpu_usage)) return;

        const perCoreUsage = [];
        const priorCycle = self.docker.procData.precpu_stats;
        const cycle = self.docker.procData.cpu_stats;
        const totalCores = _.get(cycle, 'cpu_usage.percpu_usage', { test: 1 });

        const deltaTotal = cycle.cpu_usage.total_usage - priorCycle.cpu_usage.total_usage;
        const deltaSystem = cycle.system_cpu_usage - priorCycle.system_cpu_usage;
        const totalUsage = (deltaTotal / deltaSystem) * totalCores.length * 100;

        Async.forEachOf(cycle.cpu_usage.percpu_usage, (cpu, index, callback) => {
            if (_.isObject(priorCycle.cpu_usage.percpu_usage) && index in priorCycle.cpu_usage.percpu_usage) {
                const priorCycleCpu = priorCycle.cpu_usage.percpu_usage[index];
                const deltaCore = cpu - priorCycleCpu;
                perCoreUsage.push(parseFloat(((deltaCore / deltaSystem) * totalCores.length * 100).toFixed(3).toString()));
            }
            callback();
        }, () => {
            self.processData.process = { // eslint-disable-line
                memory: {
                    total: self.docker.procData.memory_stats.usage,
                    cmax: self.docker.procData.memory_stats.max_usage,
                    amax: self.json.build.memory * 1000000,
                },
                cpu: {
                    cores: perCoreUsage,
                    total: parseFloat(totalUsage.toFixed(3).toString()),
                    limit: self.json.build.cpu,
                },
                disk: {
                    used: self.currentDiskUsed,
                    limit: self.json.build.disk,
                    io_limit: self.json.build.io,
                },
                network: self.docker.procData.networks,
            };
            self.emit('proc', self.processData.process);
        });
    }

    // If overwrite = true (PUT request) then the JSON is simply replaced with the new object keys
    // while keeping any that are not listed. If overwrite = false (PATCH request) then only the
    // specific data keys that exist are changed or added. (see _.extend documentation).
    modifyConfig(object, overwrite, next) {
        if (_.isFunction(overwrite)) {
            next = overwrite; // eslint-disable-line
            overwrite = false; // eslint-disable-line
        }

        const deepExtend = extendify({
            inPlace: false,
            arrays: 'replace',
        });

        const newObject = (overwrite) ? _.assignIn(this.json, object) : deepExtend(this.json, object);

        // Ports are a pain in the butt.
        if (!_.isUndefined(newObject.build)) {
            _.forEach(newObject.build, (obj, ident) => {
                if (_.endsWith(ident, '|overwrite')) {
                    const item = _.split(ident, '|')[0];
                    newObject.build[item] = obj;
                    delete newObject.build[ident];
                }
            });
        }

        newObject.rebuild = (_.isUndefined(object.rebuild) || object.rebuild);

        // Update 127.0.0.1 to point to the docker0 interface.
        if (newObject.build.default.ip === '127.0.0.1') {
            newObject.build.default.ip = Config.get('docker.network.ispn', false) ? '' : Config.get('docker.interface');
        }

        _.forEach(newObject.build.ports, (ports, ip) => {
            if (ip === '127.0.0.1') {
                if (!Config.get('docker.network.ispn', false)) {
                    newObject.build.ports[Config.get('docker.interface')] = ports;
                }
                delete newObject.build.ports[ip];
            }
        });

        Async.auto({
            set_knownwrite: callback => {
                this.knownWrite = true;
                this.alreadyMarkedForRebuild = this.json.rebuild;
                callback();
            },
            write_config: ['set_knownwrite', (results, callback) => {
                Fs.outputJson(this.configLocation, newObject, { spaces: 2 }, err => {
                    if (!err) this.json = newObject;
                    return callback(err);
                });
            }],
            update_live: ['write_config', (results, callback) => {
                if (
                    !_.isUndefined(_.get(object, 'build.io', undefined)) ||
                    !_.isUndefined(_.get(object, 'build.cpu', undefined)) ||
                    !_.isUndefined(_.get(object, 'build.memory', undefined)) ||
                    !_.isUndefined(_.get(object, 'build.swap', undefined))
                ) {
                    this.updateCGroups(callback);
                } else {
                    return callback();
                }
            }],
        }, err => {
            this.knownWrite = false;
            if (err) return next(err);

            if (newObject.rebuild && !this.alreadyMarkedForRebuild) {
                this.log.debug('Server has been marked as requiring a rebuild on next boot cycle.');
            }

            return next();
        });
    }

    updateCGroups(next) {
        this.log.debug('Updating some container resource limits prior to rebuild.');
        this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] Your server has had some resource limits modified, you may need to restart to apply them.`);
        this.docker.update(next);
    }

    rebuild(next) {
        // You shouldn't really be able to make it this far without this being set,
        // but for the sake of double checking...
        if (this.buildInProgress !== true) this.buildInProgress = true;
        Async.auto({
            destroy: callback => {
                this.log.debug('Checking for an existing docker container...');
                this.docker.destroy(this.json.uuid, callback);
            },
            rebuild: ['destroy', (results, callback) => {
                this.log.debug('Creating a new docker container for server...');
                this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] Rebuilding server container...`);
                this.docker.build((err, data) => {
                    callback(err, data);
                });
            }],
            update_config: ['rebuild', (results, callback) => {
                this.log.debug('New docker container successfully created for server.');
                this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] New container built, rotating hamsters...`);
                this.log.debug('Updating configuration file for server to point to new docker container.');
                this.modifyConfig({
                    rebuild: false,
                    container: {
                        id: this.json.uuid,
                        image: results.rebuild.image,
                    },
                }, false, callback);
            }],
            init_service: ['update_config', (results, callback) => {
                this.log.debug('Reinitializing egg core for server.');

                this.service = new ServiceCore(this);
                this.service.init().then(callback).catch(callback);
            }],
            init_container: ['init_service', (results, callback) => {
                this.emit('console', `${Ansi.style.yellow}[Pterodactyl Daemon] Container is being initialized...`);
                this.initContainer(callback);
            }],
        }, err => {
            this.buildInProgress = false;
            return next(err);
        });
    }

    suspend(next) {
        Async.parallel([
            callback => {
                this.modifyConfig({ suspended: 1 }, callback);
            },
            callback => {
                if (this.status !== Status.OFF) {
                    return this.kill(callback);
                }
                return callback();
            },
        ], err => {
            if (!err) {
                this.log.warn('Server has been suspended.');
            }
            return next(err);
        });
    }

    unsuspend(next) {
        Async.parallel([
            callback => {
                this.modifyConfig({ suspended: 0 }, callback);
            },
        ], err => {
            if (!err) {
                this.log.info('Server has been unsuspended.');
            }
            return next(err);
        });
    }

    blockStartup(shouldBlock, next) {
        this.blockBooting = (shouldBlock !== false);
        if (this.blockBooting) {
            this.log.warn('Server booting is now BLOCKED.');
        } else {
            this.log.info('Server booting is now UNBLOCKED.');
        }

        return next();
    }

    reinstall(config, next) {
        Async.series([
            callback => {
                this.blockStartup(true, callback);
            },
            callback => {
                this.stop(callback);
            },
            callback => {
                if (this.status !== Status.OFF) {
                    this.once('is:OFF', callback);
                } else {
                    return callback();
                }
            },
            callback => {
                if (_.isObject(config) && !_.isEmpty(config)) {
                    this.modifyConfig(config, false, callback);
                } else {
                    return callback();
                }
            },
            callback => {
                this.pack.install(callback);
            },
            callback => {
                if (_.get(this.json, 'service.skip_scripts', false)) {
                    return callback();
                }
                this.option.install(callback);
            },
            callback => {
                if (!_.isString(_.get(this.json, 'service.egg', false))) {
                    return callback(new Error('No Egg was passed to the server configuration, unable to select an egg.'));
                }

                this.service = new ServiceCore(this);
                this.service.init().then(callback).catch(callback);
            },
            callback => {
                this.pack = new PackSystem(this);
                this.option = new OptionController(this);

                return callback();
            },
            callback => {
                this.blockStartup(false, callback);
            },
        ], next);
    }
}

module.exports = Server;
