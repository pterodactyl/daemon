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
const Emitter = require('emmett');
const _ = require('underscore');

const Log = rfr('src/helpers/logger.js');
const Docker = rfr('src/controllers/docker.js');
const Service = rfr('src/services/minecraft/index.js');
const Status = rfr('src/helpers/status.js');

const Websocket = rfr('src/http/socket.js');
const UploadServer = rfr('src/http/upload.js');

class Server extends Emitter {

    constructor(json, next) {
        super();
        const self = this;
        this.status = Status.OFF;
        this.json = json;
        this.uuid = this.json.uuid;
        this.processData = {};

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
        const self = this;
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

        this.docker.stop(function stopDockerStop(err) {
            self.setStatus(Status.OFF);
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
            this.setStatus(Status.OFF);
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

}

module.exports = Server;
