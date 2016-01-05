'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
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
        this.statSocket = Socket.of('/stats/');
        this.statSocket.use(function socketConstructor(params, next) {
            if (!params.handshake.query.token) {
                return next(new Error('You must pass the correct handshake values.'));
            }
            if (typeof Config.get('keys') !== 'object' || Config.get('keys').indexOf(params.handshake.query.token) < 0) {
                return next(new Error('Invalid handshake value passed.'));
            }
            return next();
        });
    }

    init() {
        const self = this;
        setInterval(function () {
            self.send();
        }, 2000);
    }

    send() {
        const self = this;
        const responseData = {};
        const statData = {
            memory: 0,
            cpu: 0,
            players: 0,
        };
        Async.each(Servers, function (server, callback) {
            responseData[server.json.uuid] = {
                container: server.json.container,
                service: server.json.service,
                status: server.status,
                query: server.processData.query,
                proc: server.processData.process,
            };
            if (server.status !== Status.OFF) {
                statData.memory = statData.memory + _.get(server.processData, 'process.memory.total', 0);
                statData.cpu = statData.cpu + _.get(server.processData, 'process.cpu.total', 0);
                statData.players = statData.players + _.get(server.processData, 'query.players.length', 0);
            }
            return callback();
        }, function () {
            self.statSocket.emit('live-stats', {
                'servers': responseData,
                'stats': statData,
            });
        });
    }
}

module.exports = Stats;
