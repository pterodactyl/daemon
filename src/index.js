/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const InitializeServers = rfr('lib/helpers/initialize.js');
const ServerInitializer = new InitializeServers();

ServerInitializer.init(function () {
    rfr('lib/http/restify.js');
});
