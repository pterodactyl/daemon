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
        // Master Controller; permissions not reliant on a specific server being defined.
        if (perm.indexOf('c:') === 0) {
            if (typeof Config.get('keys') === 'object' && Config.get('keys').indexOf(this.token) > -1) {
                return true;
            }
        }

        // All other permissions controllers, do rely on a specific server being defined.
        // Both 'c:*' and 'g:*' permissions use the same permission checking, but 'g:*' permissions
        // require that a server header also be sent with the request.
        if (!this.token || !this.uuid) {
            this.res.send(403, { 'error': 'Missing required X-Access-Server headers.' });
            return false;
        }

        if (typeof Servers[this.uuid] !== 'undefined') {
            if (perm.indexOf('g:') === 0) {
                if (typeof Config.get('keys') === 'object' && Config.get('keys').indexOf(this.token) > -1) {
                    return true;
                }
            }
            if (perm.indexOf('s:') === 0) {
                if (typeof Config.get('keys') === 'object' && Config.get('keys').indexOf(this.token) > -1) {
                    return true;
                }
                if (Servers[this.uuid].hasPermission(perm, this.token)) {
                    return true;
                }
            }
        }

        this.res.send(403, { 'error': 'You do not have permission to perform that action on the system.' });
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
