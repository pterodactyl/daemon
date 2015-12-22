/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');

const LoadConfig = rfr('lib/helpers/config.js');
const Log = rfr('lib/helpers/logger.js');
const Restify = require('restify');

const Config = new LoadConfig();

const Server = Restify.createServer({
    name: 'Pterodactyl Daemon',
});

Server.get('/', function getIndex(req, res) {
    res.send('Hello World.');
});

Server.listen(Config.get('web.listen', 8080), function listen() {
    Log.info('Webserver listening on 0.0.0.0:8080');
});
