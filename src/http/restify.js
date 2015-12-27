'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const Restify = require('restify');
const Bunyan = require('bunyan');
const Path = require('path');

const ConfigHelper = rfr('src/helpers/config.js');
const Config = new ConfigHelper();

const RestLogger = Bunyan.createLogger({
    name: 'restify.logger',
    serializers: Bunyan.stdSerializers,
    streams: [
        {
            level: 'info',
            type: 'rotating-file',
            path: Path.join(Config.get('logger.path', 'logs/'), 'request.log'),
            period: '1d',
            count: 3,
        },
    ],
});

const RestServer = Restify.createServer({
    name: 'Pterodactyl Daemon',
    log: RestLogger,
});

RestServer.pre(function (request, response, next) {
    request.log.info({ req: request, res: response });
    return next();
});

// Export this for Socket.io to make use of.
module.exports = RestServer;
