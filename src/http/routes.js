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
const BuilderController = rfr('src/controllers/builder.js');
const ResponseHelper = rfr('src/helpers/responses.js');
const RestServer = rfr('src/http/restify.js');

const Config = new LoadConfig();

let Auth;
let Responses;

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
    Auth.init(function (err) {
        if (!err) {
            Responses = new ResponseHelper(req, res);
            return next();
        }
        return res.send(403, { 'error': err.message });
    });
});

RestServer.on('uncaughtException', function restifyUncaughtExceptionHandler(req, res, route, err) {
    Log.fatal({ path: route.spec.path, method: route.spec.method, msg: err.message }, err.stack);
    return res.send(503, { 'error': 'An unhandled exception occured while attempting to process this request.' });
});

RestServer.get('/', function getIndex(req, res) {
    res.send('Pterodactyl Management Daemon.');
});

/**
 * Save New Configuration for Daemon; also updates the config across the program for immediate changes.
 */
RestServer.put('/config', function putConfig(req, res) {
    if (!Auth.allowed('g:put-config')) return;
    Config.save(req.params, function (err) {
        if (err) return res.send(500, { 'error': err.message });
        return res.send(204);
    });
});

RestServer.get('/server/power/:action', function getServerPower(req, res) {
    if (!Auth.allowed('s:power')) return;
    if (req.params.action === 'start') {
        Auth.server().start(function (err) {
            return Responses.generic204(err);
        });
    } else if (req.params.action === 'stop') {
        Auth.server().stop(function (err) {
            return Responses.generic204(err);
        });
    } else if (req.params.action === 'restart') {
        Auth.server().restart(function (err) {
            return Responses.generic204(err);
        });
    } else if (req.params.action === 'kill') {
        Auth.server().kill(function (err) {
            return Responses.generic204(err);
        });
    } else {
        res.send(404, { 'error': 'Unknown power action recieved.' });
    }
});

RestServer.post('/server/command', function postServerCommand(req, res) {
    if (!Auth.allowed('s:command')) return;
    if (typeof req.params.command !== 'undefined') {
        Auth.server().command(req.params.command, function (err) {
            return Responses.generic204(err);
        });
    } else {
        res.send(500, { 'error': 'Missing command in request.' });
    }
});

/**
 * Write new server file to disk.
 */
RestServer.post('/server/new', function postServerNew(req, res) {
    const Builder = new BuilderController(req.params);
    Builder.init(function (err) {
        if (err) {
            Log.error(err, 'An error occured while attempting to initalize a new server.');
            return res.send(500);
        }
        return res.send(204);
    });
});

RestServer.listen(Config.get('web.listen', 8080), Config.get('web.host', '0.0.0.0'), function listen() {
    Log.info(Util.format('The following services are now listening on %s:%d: REST, Websocket, Uploads',
        Config.get('web.host', '0.0.0.0'),
        Config.get('web.listen', 8080)
    ));
});
