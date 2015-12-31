'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');

const Servers = rfr('src/helpers/initialize.js').Servers;
const LoadConfig = rfr('src/helpers/config.js');

const Config = new LoadConfig();

class AuthorizationMiddleware {
    constructor(token, uuid, res) {
        this.token = token;
        this.uuid = uuid;
        this.res = res;
    }

    init(next) {
        if (!this.token || !this.uuid) {
            return next(new Error('Missing required X-Access-Token or X-Access-Server headers in request.'));
        }
        return next();
    }

    allowed(perm) {
        if (perm.indexOf('g:') === 0) {
            if (typeof Config.get('keys') === 'object' && Config.get('keys').indexOf(this.token) > -1) {
                return true;
            }
        }

        if (perm.indexOf('s:') === 0) {
            if (typeof Config.get('keys') === 'object' && Config.get('keys').indexOf(this.token) > -1) {
                return true;
            }

            if (typeof Servers[this.server] !== 'undefined') {
                if (Servers[this.uuid].hasPermission(perm, this.token)) {
                    return true;
                }
            }
        }

        this.res.send(403, { 'error': 'You do not have permission to perform that action on the system.' });
        return false;
    }

    server() {
        return Servers[this.uuid];
    }

    serverUuid() {
        return this.uuid;
    }

    requestToken() {
        return this.token;
    }

    allServers() {
        return Servers;
    }

}

module.exports = AuthorizationMiddleware;
