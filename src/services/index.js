'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const _ = require('underscore');
const Path = require('path');
const Async = require('async');
const Fs = require('fs-extra');

const ExtendedMixin = rfr('src/helpers/deepextend.js');
const ConfigHelper = rfr('src/helpers/config.js');
const Status = rfr('src/helpers/status.js');

const Config = new ConfigHelper();

_.mixin({ 'deepExtend': ExtendedMixin });

class Core {
    constructor(server, config) {
        const self = this;
        this.server = server;
        this.json = server.json;
        this.option = this.json.service.option;
        this.object = undefined;

        // Find our data on initialization.
        _.each(config, function coreOnConstructorLoop(element) {
            if (self.option.match(element.tag)) {
                // Handle "symlink" in the configuration for plugins...
                self.object = element;
                if (typeof element.symlink !== 'undefined' && typeof config[element.symlink] !== 'undefined') {
                    self.object = _.deepExtend(config[element.symlink], element);
                }
            }
        });
    }

    onPreflight(next) {
        const self = this;
        // Check each configuration file and set variables as needed.
        Async.each(this.object.configs, function coreOnPreflightFileLoop(fileName, callback) {
            // let doUpdate = false;
            Fs.readFile(Path.join(Config.get('sftp.path', '/srv/data'), self.server.user, '/data', fileName), function coreOnPreflightReadFile(err) {
                if (err) return callback(err);
            });
        }, function (err) {
            return next(err);
        });
    }

    onStart(next) {
        return next();
    }

    onConsole(data) {
        const self = this;
        // Started
        if (data.indexOf(this.object.startup.done) > -1) {
            self.server.setStatus(Status.ON);
        }

        // Stopped; Don't trigger crash
        if (this.server.status !== Status.ON && typeof this.object.startup.userInteraction !== 'undefined') {
            Async.each(this.object.startup.userInteraction, function coreOnConsoleAsyncEach(string) {
                if (data.indexOf(string) > -1) {
                    self.server.log.info('Server detected as requiring user interaction, stopping now.');
                    self.server.setStatus(Status.STOPPING);
                }
            });
        }
    }

    onStop(next) {
        return next();
    }

    sanitizeSocketData(data) {
        return data.replace(new RegExp(this.object.output.find || '\r\n', this.object.output.flags || 'g'), this.object.output.replace || '');
    }
}

module.exports = Core;
