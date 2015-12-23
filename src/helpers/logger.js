/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const Bunyan = require('bunyan');
const Path = require('path');
const LoadConfig = rfr('lib/helpers/config.js');
const Config = new LoadConfig();

const Log = Bunyan.createLogger({
    name: 'pterodactyl.daemon',
    streams: [
        {
            level: 'debug',
            stream: process.stdout,
        },
        {
            level: 'debug',
            type: 'rotating-file',
            path: Path.join(Config.get('logPath', '/var/log/pterodactyl-daemon'), 'info.log'),
            period: '4h',
            count: 12,
        },
        {
            level: 'error',
            type: 'rotating-file',
            path: Path.join(Config.get('logPath', '/var/log/pterodactyl-daemon'), 'error.log'),
            period: '1d',
            count: 3,
        },
    ],
});

module.exports = Log;
