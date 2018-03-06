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
const Async = require('async');
const _ = require('lodash');

const ConfigHelper = rfr('src/helpers/config.js');
const Servers = rfr('src/helpers/initialize.js').Servers;
const Status = rfr('src/helpers/status.js');
const Socket = rfr('src/http/socket.js').Socket;

const Config = new ConfigHelper();

class Stats {
    constructor() {
        this.statSocket = Socket.of('/v1/stats/');
        this.statSocket.use((params, next) => {
            if (!params.handshake.query.token) {
                return next(new Error('You must pass the correct handshake values.'));
            }
            if (!_.isObject(Config.get('keys')) || !_.includes(Config.get('keys'), params.handshake.query.token)) {
                return next(new Error('Invalid handshake value passed.'));
            }
            return next();
        });
    }

    init() {
        setInterval(() => {
            this.send();
        }, 2000);
    }

    send() {
        const responseData = {};
        const statData = {
            memory: 0,
            cpu: 0,
            players: 0,
        };
        Async.each(Servers, (server, callback) => {
            responseData[server.json.uuid] = {
                container: server.json.container,
                service: server.json.service,
                status: server.status,
                query: server.processData.query,
                proc: server.processData.process,
            };
            if (server.status !== Status.OFF) {
                statData.memory += _.get(server.processData, 'process.memory.total', 0);
                statData.cpu += _.get(server.processData, 'process.cpu.total', 0);
                statData.players += _.get(server.processData, 'query.players.length', 0);
            }
            return callback();
        }, () => {
            this.statSocket.emit('live-stats', {
                'servers': responseData,
                'stats': statData,
            });
        });
    }
}

module.exports = Stats;
