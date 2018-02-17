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
const Ansi = require('ansi-escape-sequences');

const RestServer = rfr('src/http/restify.js');
const Socket = require('socket.io').listen(RestServer.server);

class WebSocket {
    constructor(server) {
        this.server = server;
        this.websocket = Socket.of(`/v1/ws/${this.server.json.uuid}`);

        this.websocket.use((params, next) => {
            if (!params.handshake.query.token) {
                return next(new Error('You must pass the correct handshake values.'));
            }

            this.server.hasPermission('s:console', params.handshake.query.token, (err, hasPermission) => {
                if (err || !hasPermission) {
                    return next(new Error('You do not have permission to access the socket for this server.'));
                }

                return next();
            });
        });
    }

    init() {
        // Send Initial Status when Websocket is connected to
        this.websocket.on('connection', activeSocket => {
            activeSocket.on('send command', data => {
                this.server.hasPermission('s:command', activeSocket.handshake.query.token, (err, hasPermission) => {
                    if (err || !hasPermission) {
                        return;
                    }

                    this.server.command(data, () => {
                        _.noop();
                    });
                });
            });

            activeSocket.on('send server log', () => {
                this.server.hasPermission('s:console', activeSocket.handshake.query.token, (err, hasPermission) => {
                    if (err || !hasPermission) {
                        return;
                    }

                    this.server.fs.readEndOfLogStream(80000, (readErr, lines) => {
                        if (readErr) {
                            this.websocket.emit('console', {
                                line: `${Ansi.style.red}[Pterodactyl Daemon] An error was encountered while attempting to read the log file!`,
                            });

                            return this.server.log.error(readErr);
                        }

                        activeSocket.emit('server log', lines);
                    });
                });
            });

            activeSocket.on('set status', data => {
                switch (data) {
                case 'start':
                case 'on':
                case 'boot':
                    this.server.hasPermission('s:power:start', activeSocket.handshake.query.token, (err, hasPermission) => {
                        if (err || !hasPermission) {
                            return;
                        }

                        this.server.start(() => { _.noop(); });
                    });
                    break;
                case 'off':
                case 'stop':
                case 'end':
                case 'quit':
                    this.server.hasPermission('s:power:stop', activeSocket.handshake.query.token, (err, hasPermission) => {
                        if (err || !hasPermission) {
                            return;
                        }

                        this.server.stop(() => { _.noop(); });
                    });
                    break;
                case 'restart':
                case 'reload':
                    this.server.hasPermission('s:power:restart', activeSocket.handshake.query.token, (err, hasPermission) => {
                        if (err || !hasPermission) {
                            return;
                        }

                        this.server.restart(() => { _.noop(); });
                    });
                    break;
                case 'kill':
                case '^C':
                    this.server.hasPermission('s:power:kill', activeSocket.handshake.query.token, (err, hasPermission) => {
                        if (err || !hasPermission) {
                            return;
                        }

                        this.server.kill(() => { _.noop(); });
                    });
                    break;
                default:
                    break;
                }
            });

            activeSocket.emit('initial status', {
                'status': this.server.status,
            });
        });

        // Send server output to Websocket.
        this.server.on('console', output => {
            const data = output.toString();
            // Is this data even worth dealing with?
            if (_.replace(data, /\s+/g, '').length > 1) {
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
    }
}

exports.ServerSockets = WebSocket;
exports.Socket = Socket;
