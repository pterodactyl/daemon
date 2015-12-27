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
});

RestServer.pre(function (req, res, next) {
    // Fix Headers
    if ('x-access-server' in req.headers && !('X-Access-Server' in req.headers)) {
        req.headers['X-Access-Server'] = req.headers['x-access-server'];
    }

    if ('x-access-token' in req.headers && !('X-Access-Token' in req.headers)) {
        req.headers['X-Access-Token'] = req.headers['x-access-token'];
    }
    return next();
});

RestServer.on('after', Restify.auditLogger({
    log: RestLogger,
}));

// Export this for Socket.io to make use of.
module.exports = RestServer;
