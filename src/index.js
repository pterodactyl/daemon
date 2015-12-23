/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const Log = rfr('lib/helpers/logger.js');
const Initializer = rfr('lib/helpers/initialize.js').Initialize;
const Initialize = new Initializer();

Log.info('Starting Pterodactyl Daemon...');

Initialize.init(function () {
    rfr('lib/http/restify.js');
});

process.on('uncaughtException', function (err) {
    Log.fatal(err, 'A fatal error occured during an operation.');
});

process.on('SIGUSR2', function () {
    Log.reopenFileStreams();
});
