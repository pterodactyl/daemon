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
    // Do Authentication
    Auth = new AuthorizationMiddleware(req.headers['X-Access-Token'], req.headers['X-Access-Server'], res);
    Auth.init(function authInit() {
        Routes = new RouteController(Auth, req, res);
        return next();
    });
});

RestServer.on('uncaughtException', function restifyUncaughtExceptionHandler(req, res, route, err) {
    Log.fatal({ path: route.spec.path, method: route.spec.method, msg: err.message }, err.stack);
    try {
        return res.send(503, { 'error': 'An unhandled exception occured while attempting to process this request.' });
    } catch (ex) {
        // Response already sent it seems.
        // Not even going to log it.
    }
});

RestServer.get('/', function routeGetIndex(req, res, next) {
    Routes.getIndex();
    return next();
});

/**
 * Save New Configuration for Daemon; also updates the config across the program for immediate changes.
 */
RestServer.put('/config', function routePutConfig(req, res, next) {
    Routes.putConfig();
    return next();
});

/**
 * Big Picture Actions
 */
RestServer.get('/servers', function routeGetServers(req, res, next) {
    Routes.getAllServers();
    return next();
});

RestServer.post('/servers', function routePostServers(req, res, next) {
    Routes.postNewServer();
    return next();
});

RestServer.del('/servers', function routeDeleteServer(req, res, next) {
    Routes.deleteServer();
    return next();
});

/**
 * Server Actions
 */
RestServer.get('/server', function routeGetServer(req, res, next) {
    Routes.getServer();
    return next();
});

RestServer.patch('/server', function routePatchServer(req, res, next) {
    Routes.updateServerConfig();
    return next();
});

RestServer.put('/server', function routePutServer(req, res, next) {
    Routes.updateServerConfig();
    return next();
});

RestServer.post('/server/rebuild', function routePostServerRebuild(req, res, next) {
    Routes.rebuildServer();
    return next();
});

RestServer.put('/server/power', function routePutServerPower(req, res, next) {
    Routes.putServerPower();
    return next();
});

RestServer.post('/server/command', function routeGetServerCommand(req, res, next) {
    Routes.postServerCommand();
    return next();
});

RestServer.get('/server/log', function routeGetServerLog(req, res, next) {
    Routes.getServerLog();
    return next();
});

RestServer.get(/^\/server\/directory\/?(.+)*/, function routeGetServerDirectory(req, res, next) {
    Routes.getServerDirectory();
    return next();
});

RestServer.get(/^\/server\/file\/(.+)/, function routeGetServerFile(req, res, next) {
    Routes.getServerFile();
    return next();
});

RestServer.post(/^\/server\/file\/(.+)/, function routePostServerFile(req, res, next) {
    Routes.postServerFile();
    return next();
});

RestServer.del(/^\/server\/file\/(.+)/, function routePostServerFile(req, res, next) {
    Routes.deleteServerFile();
    return next();
});

RestServer.listen(Config.get('web.listen', 8080), Config.get('web.host', '0.0.0.0'), function listen() {
    Log.info(Util.format('The following services are now listening on %s:%d: REST, Websocket, Uploads',
        Config.get('web.host', '0.0.0.0'),
        Config.get('web.listen', 8080)
    ));
});
