'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const RestServer = rfr('src/http/restify.js');
const Socket = require('socket.io').listen(RestServer.server);

class WebSocket {
    constructor(server) {
        this.server = server;
        this.websocket = Socket.of('/ws/' + this.server.json.uuid);
        this.installerSocket = Socket.of('/ws-install/' + this.server.json.uuid);

        // Standard Websocket Permissions
        const self = this;
        this.websocket.use(function (params, next) {
            if (!params.handshake.query.token) {
                return next(new Error('You must pass the correct handshake values.'));
            }
            if (!self.server.hasPermission('s:console', params.handshake.query.token)) {
                return next(new Error('You do not have permission to access this socket (ws).'));
            }
            return next();
        });

        // Installer Output Websocket Permissions
        this.installerSocket.use(function (params, next) {
            if (!params.handshake.query.token) {
                return next(new Error('You must pass the correct handshake values.'));
            }
            if (!self.server.hasPermission('g:socket:install', params.handshake.query.token)) {
                return next(new Error('You do not have permission to access this socket (ws-install).'));
            }
            return next();
        });
    }

    init() {
        const self = this;

        // Send Initial Status when Websocket is connected to
        this.websocket.on('connection', function websocketConnection() {
            self.websocket.emit('initial_status', {
                'status': self.server.status,
            });
        });

        // Send server output to Websocket.
        this.server.on('console', function websocketConsole(output) {
            const data = output.toString();
            // Is this data even worth dealing with?
            if ((data.replace(/\s+/g, '')).length > 1) {
                self.websocket.emit('console', {
                    'line': data,
                });
            }
        });

        // Sends query response to Websocket when it is called by the daemon function.
        this.server.on('query', function websocketQuery(query) {
            self.websocket.emit('query', {
                query,
            });
        });

        // Sends current server information to Websocket.
        this.server.on('proc', function websocketStats(data) {
            self.websocket.emit('proc', {
                data,
            });
        });

        // Sends change of server status to Websocket.
        this.server.on('status', function websocketStatus(data) {
            self.websocket.emit('status', {
                'status': data,
            });
        });

        // Sends Installer Data to Admin Websocket.
        this.server.on('installer', function adminWebsocketInstaller(output) {
            const data = output.toString();
            // Is this data even worth dealing with?
            if ((data.replace(/\s+/g, '')).length > 1) {
                self.installerSocket.emit('console', {
                    'line': data,
                });
            }
        });
    }
}

module.exports = WebSocket;
