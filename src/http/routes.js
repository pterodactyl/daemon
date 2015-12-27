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
const Util = require('util');

const Log = rfr('src/helpers/logger.js');
const LoadConfig = rfr('src/helpers/config.js');
const AuthorizationMiddleware = rfr('src/middleware/authorizable.js');
const RestServer = rfr('src/http/restify.js');
const RouteController = rfr('src/controllers/routes.js');

const Config = new LoadConfig();

let Auth;
let Routes;

RestServer.use(Restify.jsonBodyParser());
RestServer.use(Restify.CORS()); // eslint-disable-line

RestServer.use(function (req, res, next) {
    // Fix Headers
    if ('x-access-server' in req.headers && !('X-Access-Server' in req.headers)) {
        req.headers['X-Access-Server'] = req.headers['x-access-server'];
    }

    if ('x-access-token' in req.headers && !('X-Access-Token' in req.headers)) {
        req.headers['X-Access-Token'] = req.headers['x-access-token'];
    }

    // Do Authentication
    Auth = new AuthorizationMiddleware(req.headers['X-Access-Token'], req.headers['X-Access-Server'], res);
    Auth.init(function authInit(err) {
        if (!err) {
            Routes = new RouteController(Auth, req, res);
            return next();
        }
        return res.send(403, { 'error': err.message });
    });
});

RestServer.on('uncaughtException', function restifyUncaughtExceptionHandler(req, res, route, err) {
    Log.fatal({ path: route.spec.path, method: route.spec.method, msg: err.message }, err.stack);
    return res.send(503, { 'error': 'An unhandled exception occured while attempting to process this request.' });
});

RestServer.get('/', function routeGetIndex() {
    Routes.getIndex();
});

/**
 * Save New Configuration for Daemon; also updates the config across the program for immediate changes.
 */
RestServer.put('/config', function routePutConfig() {
    Routes.putConfig();
});

/**
 * Server Actions
 */
RestServer.get('/server', function routeGetServer() {
    Routes.getServer();
});

RestServer.get('/server/power/:action', function routeGetServerPower() {
    Routes.getServerPower();
});

RestServer.post('/server/command', function routeGetServerCommand() {
    Routes.postServerCommand();
});

/**
 * Write new server file to disk.
 */
RestServer.post('/server/new', function routePostServerNew() {
    Routes.postServerNew();
});

RestServer.listen(Config.get('web.listen', 8080), Config.get('web.host', '0.0.0.0'), function listen() {
    Log.info(Util.format('The following services are now listening on %s:%d: REST, Websocket, Uploads',
        Config.get('web.host', '0.0.0.0'),
        Config.get('web.listen', 8080)
    ));
});
