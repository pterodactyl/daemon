'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const Fs = require('fs-extra');

class Config {

    constructor() {
        this.configJson = this._raw();
    }

    _raw() {
        return Fs.readJsonSync('./config/core.json');
    }

    get(key, defaultResponse) {
        let getObject;
        try {
            this.configJson = this._raw(); // Without this things don't ever end up updated...
            getObject = key.split('.').reduce((o, i) => o[i], this.configJson);
        } catch (ex) {
            //
        }

        if (typeof getObject !== 'undefined') {
            return getObject;
        }

        return (typeof defaultResponse !== 'undefined') ? defaultResponse : undefined;
    }

    save(json, next) {
        const self = this;
        if (!json || typeof json !== 'object' || json === null || !Object.keys(json).length) {
            throw new Error('Invalid JSON was passed to Builder.');
        }

        Fs.writeJson('./config/core.json', json, function (err) {
            if (!err) self.configJson = json;
            return next(err);
        });
    }

}

module.exports = Config;
