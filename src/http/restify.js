'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const Restify = require('restify');

const RestServer = Restify.createServer({
    name: 'Pterodactyl Daemon',
});

// Export this for Socket.io to make use of.
module.exports = RestServer;
