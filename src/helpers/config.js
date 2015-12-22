/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');

class Config {

    _raw() {
        return rfr('config/core.json');
    }

    get(key, defaultResponse) {
        const raw = this._raw();
        const getObject = key.split('.').reduce((o, i) => o[i], raw);

        if (typeof getObject !== 'undefined') {
            return getObject;
        }

        return (typeof defaultResponse !== 'undefined') ? defaultResponse : undefined;
    }

}

module.exports = Config;
