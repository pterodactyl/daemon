'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2016 Dane Everitt <dane@daneeveritt.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
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

RestServer.opts(/.*/, (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', req.header('Access-Control-Request-Method'));
    res.header('Access-Control-Allow-Headers', req.header('Access-Control-Request-Headers'));
    res.send(200);
    return next();
});

RestServer.use((req, res, next) => {
    // Do Authentication
    Auth = new AuthorizationMiddleware(req.headers['X-Access-Token'], req.headers['X-Access-Server'], res);
    Auth.init(() => {
        Routes = new RouteController(Auth, req, res);
        return next();
    });
});

RestServer.on('uncaughtException', (req, res, route, err) => {
    Log.fatal({ path: route.spec.path, method: route.spec.method, msg: err.message }, err.stack);
    try {
        return res.send(503, { 'error': 'An unhandled exception occured while attempting to process this request.' });
    } catch (ex) {
        // Response already sent it seems.
        // Not even going to log it.
    }
});

RestServer.get('/', (req, res, next) => {
    Routes.getIndex();
    return next();
});

/**
 * Save New Configuration for Daemon; also updates the config across the program for immediate changes.
 */
RestServer.put('/config', (req, res, next) => {
    Routes.putConfig();
    return next();
});

/**
 * Big Picture Actions
 */
RestServer.get('/servers', (req, res, next) => {
    Routes.getAllServers();
    return next();
});

RestServer.post('/servers', (req, res, next) => {
    Routes.postNewServer();
    return next();
});

RestServer.del('/servers', (req, res, next) => {
    Routes.deleteServer();
    return next();
});

/**
 * Server Actions
 */
RestServer.get('/server', (req, res, next) => {
    Routes.getServer();
    return next();
});

RestServer.patch('/server', (req, res, next) => {
    Routes.updateServerConfig();
    return next();
});

RestServer.put('/server', (req, res, next) => {
    Routes.updateServerConfig();
    return next();
});

RestServer.post('/server/password', (req, res, next) => {
    Routes.setSFTPPassword();
    return next();
});

RestServer.post('/server/rebuild', (req, res, next) => {
    Routes.rebuildServer();
    return next();
});

RestServer.put('/server/power', (req, res, next) => {
    Routes.putServerPower();
    return next();
});

RestServer.post('/server/command', (req, res, next) => {
    Routes.postServerCommand();
    return next();
});

RestServer.get('/server/log', (req, res, next) => {
    Routes.getServerLog();
    return next();
});

RestServer.post('/server/files/copy', (req, res, next) => {
    Routes.postFilesRename();
    return next();
});

RestServer.post(/^\/server\/files\/(move|rename)/, (req, res, next) => {
    Routes.postFilesMove();
    return next();
});

RestServer.get(/^\/server\/files\/stat\/(.+)/, (req, res, next) => {
    Routes.getServerFileStat();
    return next();
});

RestServer.get(/^\/server\/directory\/?(.+)*/, (req, res, next) => {
    Routes.getServerDirectory();
    return next();
});

RestServer.get(/^\/server\/file\/(.+)/, (req, res, next) => {
    Routes.getServerFile();
    return next();
});

RestServer.post(/^\/server\/file\/(.+)/, (req, res, next) => {
    Routes.postServerFile();
    return next();
});

RestServer.del(/^\/server\/file\/(.+)/, (req, res, next) => {
    Routes.deleteServerFile();
    return next();
});

RestServer.get(/^\/server\/download\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/, (req, res, next) => {
    Routes.downloadServerFile();
    return next();
});

RestServer.post('/server/suspend', (req, res, next) => {
    Routes.postServerSuspend();
    return next();
});

RestServer.post('/server/unsuspend', (req, res, next) => {
    Routes.postServerUnsuspend();
    return next();
});

RestServer.listen(Config.get('web.listen', 8080), Config.get('web.host', '0.0.0.0'), () => {
    Log.info(Util.format('Pterodactyl Daemon is now listening for %s connections on %s:%s',
        (Config.get('web.ssl.enabled') === true) ? 'secure' : 'insecure',
        Config.get('web.host', '0.0.0.0'),
        Config.get('web.listen', 8080)
    ));
});
