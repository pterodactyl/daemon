'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2018 Dane Everitt <dane@daneeveritt.com>.
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
const Fs = require('fs-extra');
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
            period: '4h',
            count: 3,
        },
    ],
});

const RestServer = Restify.createServer({
    name: 'Pterodactyl Daemon',
    certificate: (Config.get('web.ssl.enabled') === true) ? Fs.readFileSync(Config.get('web.ssl.certificate')) : null,
    key: (Config.get('web.ssl.enabled') === true) ? Fs.readFileSync(Config.get('web.ssl.key')) : null,
    formatters: {
        'application/json': (req, res, body, callback) => {
            callback(null, JSON.stringify(body, null, 4));
        },
    },
});

RestServer.pre((req, res, next) => {
    // Fix Headers
    if ('x-access-server' in req.headers && !('X-Access-Server' in req.headers)) {
        req.headers['X-Access-Server'] = req.headers['x-access-server']; // eslint-disable-line
    }

    if ('x-access-token' in req.headers && !('X-Access-Token' in req.headers)) {
        req.headers['X-Access-Token'] = req.headers['x-access-token']; // eslint-disable-line
    }
    return next();
});

RestServer.on('after', Restify.auditLogger({
    log: RestLogger,
}));

// Export this for Socket.io to make use of.
module.exports = RestServer;
