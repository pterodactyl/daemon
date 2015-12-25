/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const Path = require('path');
const Async = require('async');
const Fs = require('fs-extra');
const _ = require('underscore');

const ConfigHelper = rfr('lib/helpers/config.js');
const Configuration = rfr('src/services/minecraft/main.json');
const ExtendedMixin = rfr('lib/helpers/deepextend.js');

const Config = new ConfigHelper();

_.mixin({ 'deepExtend': ExtendedMixin });

class Plugin {
    constructor(server) {
        const self = this;
        this._server = server;
        this._json = server._json;
        this.option = this._json.service.option;
        this.object = undefined;

        // Find our data on initialization.
        _.each(Configuration, function onConstructorLoop(element) {
            if (self.option.match(element.regex)) {
                // Handle "symlink" in the configuration for plugins...
                self.object = element;
                if (typeof element.symlink !== 'undefined' && typeof Configuration[element.symlink] !== 'undefined') {
                    self.object = _.deepExtend(Configuration[element.symlink], element);
                }
            }
        });
    }

    onPreflight(next) {
        const self = this;
        // Check each configuration file and set variables as needed.
        Async.each(this.object.configs, function onPreflightFileLoop(fileName, callback) {
            // let doUpdate = false;
            Fs.readFile(Path.join(Config.get('sftp.path', '/srv/data'), self._server.user, '/data', fileName), function (err) {
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
            self._server.log.info('Server detected as fully started.');
            self._server.status = 1;
        }

        // Stopped; Don't trigger crash
        if (this._server.status !== 1 && typeof this.object.startup.userInteraction !== 'undefined') {
            Async.each(this.object.startup.userInteraction, function onConsoleAsyncEach(string) {
                if (data.indexOf(string) > -1) {
                    self._server.log.info('Server detected as requiring user interaction, stopping now.');
                    self._server.status = 3;
                }
            });
        }
    }

    onStop(next) {
        return next();
    }
}

module.exports = Plugin;
