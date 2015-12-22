/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

class Server {
    constructor(json) {
        this._json = json;
        this._uuid = json.uuid;
    }

    /**
     * Returns UUID of the given server.
     * @return string
     */
    uuid() {
        return this._uuid;
    }
}

module.exports = Server;
