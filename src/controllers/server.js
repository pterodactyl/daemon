'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const Async = require('async');
const moment = require('moment');
const _ = require('underscore');
const EventEmitter = require('events').EventEmitter;
const Querystring = require('querystring');
const Path = require('path');

const Log = rfr('src/helpers/logger.js');
const Docker = rfr('src/controllers/docker.js');
const Service = rfr('src/services/minecraft/index.js');
const Status = rfr('src/helpers/status.js');
const ConfigHelper = rfr('src/helpers/config.js');
const Websocket = rfr('src/http/socket.js');
const UploadServer = rfr('src/http/upload.js');
const FileSystem = rfr('src/controllers/fs.js');

const Config = new ConfigHelper();

class Server extends EventEmitter {

    constructor(json, next) {
        super();
        const self = this;
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

        this.log = Log.child({ server: this.uuid });
        this.lastCrash = undefined;

        this.docker = new Docker(this, function constructorServer(err, status) {
            if (status === true) {
                self.log.info('Daemon detected that the server container is currently running, re-attaching to it now!');
            }
            return next(err);
        });

        this.service = new Service(this);

        this.socketIO = new Websocket(this).init();
        this.uploadSocket = new UploadServer(this).init();
        this.fs = new FileSystem(this);
    }

    hasPermission(perm, token) {
        if (typeof perm !== 'undefined' && typeof token !== 'undefined') {
            if (typeof this.json.keys !== 'undefined' && token in this.json.keys) {
                if (this.json.keys[token].indexOf(perm) > -1) {
                    return true;
                }
            }
        }
        return false;
    }

    setStatus(status) {
        if (status === this.status) return;
        const inverted = _.invert(Status);

        // If a user starts their server and then tries to stop it before the server is done
        // it triggers a crash condition. This logic determines if the server status is set to
        // stopping, and if so, we prevent changing the status to starting or on. This allows the
        // server to not crash when we press stop before it is compeltely started.
        if (this.status === Status.STOPPING && (status === Status.ON || status === Status.STARTING)) {
            this.log.debug('Recieved request to mark server as ' + inverted[status] + ' but the server is currently marked as STOPPING.');
            return;
        }

        // Handle Internal Tracking
        if (status !== Status.OFF) {
            // If an interval has not been started, start one now.
            if (this.intervals.process === null) {
                this.intervals.process = setInterval(this.process, 2000, this);
            }
        } else {
            // Server has been stopped, lets clear the interval as well as any stored
            // information about the process or query. Lets also detach the stats stream.
            clearInterval(this.intervals.process);
            this.intervals.process = null;
            this.processData.process = {};
            this.processData.query = {};
        }

        this.log.info('Server status has been changed to ' + inverted[status]);
        this.status = status;
        this.emit('status', status);
    }

    preflight(next) {
        // Return immediately if server is currently powered on.
        if (this.status !== Status.OFF) {
            return next(new Error('Server is already running.'));
        }
        // @TODO: plugin specific preflights
        return next();
    }

    start(next) {
        const self = this;
        if (this.status !== Status.OFF) {
            return next(new Error('Server is already running.'));
        }

        Async.series([
            function startAsyncPreflight(callback) {
                self.log.debug('Initializing for boot sequence, running preflight checks.');
                self.preflight(callback);
            },
            function startAsyncStart(callback) {
                self.docker.start(callback);
            },
            function startAsyncAttach(callback) {
                self.docker.attach(callback);
            },
        ], function startAsyncDone(err, reboot) {
            if (err) {
                self.log.error(err);
                return next(err);
            }

            if (typeof reboot !== 'undefined') {
                // @TODO: Handle the need for a reboot here.
            }
            return next();
        });
    }

    stop(next) {
        if (this.status === Status.OFF) {
            return next(new Error('Server is already stopped.'));
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
        this.command(this.service.object.stop, function (err) {
            return next(err);
        });
    }

    kill(next) {
        const self = this;
        if (this.status === Status.OFF) {
            return next(new Error('Server is already stopped.'));
        }

        this.setStatus(Status.STOPPING);
        this.docker.kill(function killDockerKill(err) {
            self.log.info('Process SIGINT request for server. Server will be forciably stopped.');
            self.setStatus(Status.OFF);
            return next(err);
        });
    }

    restart(next) {
        const self = this;
        Async.series([
            function restartAsyncStop(callback) {
                if (self.status !== Status.OFF) {
                    self.stop(callback);
                } else {
                    // Already off, lets move on.
                    return callback();
                }
            },
            function restartAsyncStart(callback) {
                self.start(callback);
            },
        ], function restartAsycDone(err) {
            return next(err);
        });
    }

    /**
     * Send output from server container to websocket.
     */
    output(output) {
        if (output.replace(/[\x00-\x1F\x7F-\x9F]/g, '') === null || output.replace(/[\x00-\x1F\x7F-\x9F]/g, '') === '' || output.replace(/[\x00-\x1F\x7F-\x9F]/g, '') === ' ') {
            return;
        }
        // For now, log to console, and strip control characters from output.
        this.service.onConsole(output);
    }

    /**
     * Send command to server.
     */
    command(command, next) {
        if (this.status === Status.OFF) {
            return next(new Error('Server is currently stopped.'));
        }

        // Prevent a user sending a stop command manually from crashing the server.
        if (command.startsWith(this.service.object.stop)) {
            this.setStatus(Status.STOPPING);
        }

        this.docker.write(command, next);
    }

    /**
     * Determines if the container stream should have ended yet, if not, mark server crashed.
     */
    streamClosed() {
        const self = this;

        if (this.status === Status.OFF || this.status === Status.STOPPING) {
            this.setStatus(Status.OFF);
            return;
        }

        this.setStatus(Status.OFF);
        if (moment.isMoment(this.lastCrash)) {
            if (moment(this.lastCrash).add(60, 'seconds').isAfter(moment())) {
                this.setCrashTime();
                this.log.debug('Server detected as crashed but has crashed within the last 60 seconds, aborting reboot.');
                return;
            }
        }

        this.log.debug('Server detected as crashed... attempting reboot.');
        this.setCrashTime();

        this.start(function streamClosedStart(err) {
            if (err) self.log.fatal(err);
        });
    }

    setCrashTime() {
        this.lastCrash = moment();
    }

    path(location) {
        const dataPath = Path.join(Config.get('sftp.path', '/srv/data'), this.json.user, '/data');
        const cleanLocation = location.replace(/\s+/g, '');
        let returnPath;

        if (typeof location !== 'undefined' && cleanLocation.length > 0) {
            returnPath = Path.join(dataPath, Path.normalize(Querystring.unescape(cleanLocation)));
        }

        // Path is good, return it.
        if (returnPath.startsWith(dataPath)) {
            return returnPath;
        }

        this.log.debug({ attemted_path: returnPath }, 'Attempted to access file outside of SFTP path, defaulted to SFTP data directory.');
        return dataPath;
    }

    process(self) {
        if (self.status === Status.OFF) return;

        // When the server is started a stream of process data is begun
        // which is stored in Docker.procData. We wilol now access that
        // and process it.
        if (typeof self.docker.procData === 'undefined') return;

        // We need previous cycle information as well.
        if (typeof self.docker.procData.precpu_stats.cpu_usage === 'undefined') return;

        const perCoreUsage = [];
        const priorCycle = self.docker.procData.precpu_stats;
        const cycle = self.docker.procData.cpu_stats;

        const deltaTotal = cycle.cpu_usage.total_usage - priorCycle.cpu_usage.total_usage;
        const deltaSystem = cycle.system_cpu_usage - priorCycle.system_cpu_usage;
        const totalUsage = (deltaTotal / deltaSystem) * cycle.cpu_usage.percpu_usage.length * 100;

        Async.forEachOf(cycle.cpu_usage.percpu_usage, function (cpu, index, callback) {
            if (index in priorCycle.cpu_usage.percpu_usage) {
                const priorCycleCpu = priorCycle.cpu_usage.percpu_usage[index];
                const deltaCore = cpu - priorCycleCpu;
                perCoreUsage.push(parseFloat(((deltaCore / deltaSystem) * 100).toFixed(6).toString()));
            }
            callback();
        }, function () {
            self.processData.process = {
                memory: {
                    total: self.docker.procData.memory_stats.usage,
                    max: self.docker.procData.memory_stats.max_usage,
                },
                cpu: {
                    cores: perCoreUsage,
                    total: parseFloat(totalUsage.toFixed(6).toString()),
                },
            };
            self.emit('proc', self.processData.process);
        });
    }

}

module.exports = Server;
