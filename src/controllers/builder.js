/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const Async = require('async');
const Fs = require('fs-extra');
const Path = require('path');
const InitializeHelper = rfr('lib/helpers/initialize.js').Initialize;
const ServerInitializer = new InitializeHelper();

class Builder {

    constructor(json) {
        if (!json || typeof json !== 'object' || json === null || !Object.keys(json).length) {
            throw new Error('Invalid JSON was passed to Builder.');
        }
        this._json = json;
    }

    init(next) {
        const self = this;
        Async.series([
            function initAsyncWriteConfig(callback) {
                self.writeConfigToDisk(callback);
            },
            function initAsyncInitialize(callback) {
                ServerInitializer.setup(self._json, callback);
            },
            function initAsyncBuildContainer(callback) {
                self.buildContainer(self._json.uuid, callback);
            },
        ], function initAsyncCallback(err) {
            return next(err);
        });
    }

    writeConfigToDisk(next) {
        const self = this;
        // Attempt to write to disk, return error if failed, otherwise return nothing.
        // Theoretically every time this is called we should consider rebuilding the container
        // and re initalize the server. Buider.init() handles this though.
        Fs.writeJson(Path.join('./config/servers', self._json.uuid + '.json'), self._json, function writeConfigWrite(err) {
            return next(err);
        });
    }

    buildContainer(uuid, next) {
        return next();
    }

}

module.exports = Builder;
