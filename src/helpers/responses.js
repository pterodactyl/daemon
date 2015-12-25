/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

class Responses {
    constructor(req, res) {
        this._req = req;
        this._res = res;
    }

    generic204(err) {
        if (err) {
            return this.generic500(err);
        }
        return this._res.send(204);
    }

    generic500(err) {
        return this._res.send(500, {
            'error': err.message,
            'route': this._req.path,
            'req_id': this._req.id,
            'type': this._req.contentType,
        });
    }

}

module.exports = Responses;
