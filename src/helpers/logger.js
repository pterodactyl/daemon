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
    src: Config.get('logger.src', false),
    streams: [
        {
            level: Config.get('logger.level', 'info'),
            stream: process.stdout,
        },
        {
            level: Config.get('logger.level', 'info'),
            type: 'rotating-file',
            path: Path.join(Config.get('logger.path', 'logs/'), 'info.log'),
            period: Config.get('logger.period', '1d'),
            count: Config.get('logger.count', 3),
        },
        {
            level: 'error',
            type: 'rotating-file',
            path: Path.join(Config.get('logger.path', 'logs/'), 'error.log'),
            period: '1d',
            count: 3,
        },
    ],
});

module.exports = Log;
