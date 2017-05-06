'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2017 Dane Everitt <dane@daneeveritt.com>.
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
const _ = require('lodash');

const Servers = rfr('src/helpers/initialize.js').Servers;
const LoadConfig = rfr('src/helpers/config.js');

const Config = new LoadConfig();

class AuthorizationMiddleware {
    constructor(token, uuid, res) {
        this.token = token;
        this.uuid = uuid;
        this.res = res;
    }

    init(next) {
        return next();
    }

    allowed(perm) {
        const configKeys = Config.get('keys');

        if (!_.isObject(configKeys)) {
            return false;
        }

        if (!this.token) {
            this.res.send(400, { 'error': 'Missing required X-Access-Token header.' });
            return false;
        }

        // Master Controller; permissions not reliant on a specific server being defined.
        if (_.startsWith(perm, 'c:')) {
            if (_.includes(configKeys, this.token)) {
                return true;
            }
            this.res.send(403, { 'error': 'You do not have permission to perform this action aganist the system.' });
            return false;
        }

        // All other permissions controllers, do rely on a specific server being defined.
        // Both 'c:*' and 'g:*' permissions use the same permission checking, but 'g:*' permissions
        // require that a server header also be sent with the request.
        if (!this.uuid) {
            this.res.send(400, { 'error': 'Missing required X-Access-Server headers.' });
            return false;
        }

        if (!_.isUndefined(Servers[this.uuid])) {
            if (_.startsWith(perm, 'g:')) {
                if (_.includes(configKeys, this.token)) {
                    return true;
                }
            }

            if (_.startsWith(perm, 's:')) {
                if (Servers[this.uuid].isSuspended()) {
                    this.res.send(403, { 'error': 'This server is suspended and cannot be accessed with this token.' });
                    return false;
                }

                if (_.includes(configKeys, this.token) || Servers[this.uuid].hasPermission(perm, this.token)) {
                    return true;
                }
            }

            this.res.send(403, { 'error': 'You do not have permission to perform this action for this server.' });
            return false;
        }

        this.res.send(404, { 'error': 'Unknown server defined in X-Access-Server header.' });
        return false;
    }

    server() {
        return Servers[this.uuid];
    }

    serverUuid() {
        return this.uuid;
    }

    requestToken() {
        return this.token;
    }

    allServers() {
        return Servers;
    }

}

module.exports = AuthorizationMiddleware;
