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

const RestServer = rfr('src/http/restify.js');
const Socket = require('socket.io').listen(RestServer.server);

class WebSocket {
    constructor(server) {
        this.server = server;
        this.websocket = Socket.of(`/ws/${this.server.json.uuid}`);
        this.installerSocket = Socket.of(`/ws-install/${this.server.json.uuid}`);

        // Standard Websocket Permissions
        this.websocket.use((params, next) => {
            if (!params.handshake.query.token) {
                return next(new Error('You must pass the correct handshake values.'));
            }
            if (!this.server.hasPermission('s:console', params.handshake.query.token)) {
                return next(new Error('You do not have permission to access this socket (ws).'));
            }
            return next();
        });

        // Installer Output Websocket Permissions
        this.installerSocket.use((params, next) => {
            if (!params.handshake.query.token) {
                return next(new Error('You must pass the correct handshake values.'));
            }
            if (!this.server.hasPermission('g:socket:install', params.handshake.query.token)) {
                return next(new Error('You do not have permission to access this socket (ws-install).'));
            }
            return next();
        });
    }

    init() {
        // Send Initial Status when Websocket is connected to
        this.websocket.on('connection', () => {
            this.websocket.emit('initial_status', {
                'status': this.server.status,
            });
        });

        // Send server output to Websocket.
        this.server.on('console', output => {
            const data = output.toString();
            // Is this data even worth dealing with?
            if ((data.replace(/\s+/g, '')).length > 1) {
                this.websocket.emit('console', {
                    'line': data,
                });
            }
        });

        // Sends query response to Websocket when it is called by the daemon function.
        this.server.on('query', query => {
            this.websocket.emit('query', {
                query,
            });
        });

        // Sends current server information to Websocket.
        this.server.on('proc', data => {
            this.websocket.emit('proc', {
                data,
            });
        });

        // Sends change of server status to Websocket.
        this.server.on('status', data => {
            this.websocket.emit('status', {
                'status': data,
            });
        });

        this.server.on('crashed', () => {
            this.websocket.emit('crashed');
        });

        // Sends Installer Data to Admin Websocket.
        this.server.on('installer', output => {
            const data = output.toString();
            // Is this data even worth dealing with?
            if ((data.replace(/\s+/g, '')).length > 1) {
                this.installerSocket.emit('console', {
                    'line': data,
                });
            }
        });
    }
}

exports.ServerSockets = WebSocket;
exports.Socket = Socket;
