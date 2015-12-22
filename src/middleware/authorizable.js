/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');

const Servers = rfr('lib/helpers/initialize.js').Servers;
const LoadConfig = rfr('lib/helpers/config.js');

const Config = new LoadConfig();

class AuthorizationMiddleware {
    constructor(token, server, res) {
        this._token = token;
        this._server = server;
        this._res = res;
    }

    init(next) {
        if (!this._token || !this._server) {
            return next(new Error('Missing required X-Access-Token or X-Access-Server headers in request.'));
        }
        return next();
    }

    allowed(perm) {
        if (perm.indexOf('g:') === 0) {
            if (typeof Config.get('keys') === 'object' && Config.get('keys').indexOf(this._token) > -1) {
                return true;
            }
        }

        if (perm.indexOf('s:') === 0) {
            if (typeof Servers[this._server] !== 'undefined') {
                if (Servers[this._server].hasPermission(perm, this._token)) {
                    return true;
                }
            }
        }

        this._res.send(403, { 'error': 'You do not have permission to perform that action on the system.' });
        return false;
    }

}

module.exports = AuthorizationMiddleware;
