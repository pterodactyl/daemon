'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');

const Configuration = rfr('src/services/minecraft/main.json');
const Core = rfr('src/services/index.js');

class Service extends Core {
    constructor(server) {
        super(server, Configuration);
    }

    onPreflight(next) {
        return super.onPreflight(next);
    }

    onStart(next) {
        return super.onStart(next);
    }

    onConsole(data) {
        return super.onConsole(data);
    }

    onStop(next) {
        return super.onStop(next);
    }

    sanitizeSocketData(data) {
        return super.sanitizeSocketData(data);
    }

}

module.exports = Service;
