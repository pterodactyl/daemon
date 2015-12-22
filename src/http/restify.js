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
const AuthorizationMiddleware = rfr('lib/middleware/authorizable.js');
const Restify = require('restify');
const BuilderController = rfr('lib/controllers/builder.js');

const Config = new LoadConfig();
let Auth;

const Server = Restify.createServer({
    name: 'Pterodactyl Daemon',
});

Server.use(Restify.bodyParser());
Server.use(function (req, res, next) {
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
            return next();
        }
        return res.send(403, { 'error': err.message });
    });
});

Server.on('uncaughtException', function (req, res, route, err) {
    Log.fatal({ path: route.spec.path, method: route.spec.method }, err.stack);
    return res.send(500);
});

Server.get('/', function (req, res) {
    if (!Auth.allowed('g:default')) return;
    res.send('Hello World.');
});

/**
 * Save New Configuration for Daemon; also updates the config across the program for immediate changes.
 */
Server.put('/config', function (req, res) {
    if (!Auth.allowed('g:put-config')) return;
    Config.save(req.params, function (err) {
        if (err) return res.send(500, { 'error': err.message });
        return res.send(204);
    });
});

Server.post('/server/new', function (req, res) {
    const Builder = new BuilderController(req.params);
    Builder.init(function (err) {
        if (err) {
            Log.error(err, 'An error occured while attempting to initalize a new server.');
            return res.send(500);
        }
        return res.send(204);
    });
});

Server.listen(Config.get('web.listen', 8080), function listen() {
    Log.info('Webserver listening on 0.0.0.0:8080');
});
