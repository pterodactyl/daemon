'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');

const ConfigHelper = rfr('src/helpers/config.js');
const ResponseHelper = rfr('src/helpers/responses.js');
const BuilderController = rfr('src/controllers/builder.js');
const Log = rfr('src/helpers/logger.js');

const Config = new ConfigHelper();
let Responses;
let Auth;

class RouteController {
    constructor(auth, req, res) {
        this.req = req;
        this.res = res;
        Auth = auth;
        Responses = new ResponseHelper(req, res);
    }

    // Returns Index
    getIndex() {
        this.res.send('Pterodactyl Management Daemon');
    }

    // Saves config to disk
    putConfig() {
        if (!Auth.allowed('g:put-config')) return;
        Config.save(this.req.params, function (err) {
            if (err) return this.res.send(500, { 'error': err.message });
            return this.res.send(204);
        });
    }

    // Handles server power
    getServerPower() {
        if (!Auth.allowed('s:power')) return;
        if (this.req.params.action === 'start') {
            Auth.server().start(function (err) {
                return Responses.generic204(err);
            });
        } else if (this.req.params.action === 'stop') {
            Auth.server().stop(function (err) {
                return Responses.generic204(err);
            });
        } else if (this.req.params.action === 'restart') {
            Auth.server().restart(function (err) {
                return Responses.generic204(err);
            });
        } else if (this.req.params.action === 'kill') {
            Auth.server().kill(function (err) {
                return Responses.generic204(err);
            });
        } else {
            this.res.send(404, { 'error': 'Unknown power action recieved.' });
        }
    }

    getServer() {
        if (!Auth.allowed('s:get')) return;
        this.res.send({
            container: Auth.server().json.container,
            service: Auth.server().json.service,
            status: Auth.server().status,
            query: Auth.server().processData.query,
            proc: Auth.server().processData.process,
        });
    }

    // Sends command to server
    postServerCommand() {
        if (!Auth.allowed('s:command')) return;
        if (typeof this.req.params.command !== 'undefined') {
            Auth.server().command(this.req.params.command, function (err) {
                return Responses.generic204(err);
            });
        } else {
            this.res.send(500, { 'error': 'Missing command in request.' });
        }
    }

    // Creates new server on the system.
    postServerNew() {
        const self = this;
        if (!Auth.allowed('g:server:new')) return;
        const Builder = new BuilderController(this.req.params);
        Builder.init(function (err) {
            if (err) {
                Log.error(err, 'An error occured while attempting to initalize a new server.');
                return Responses.generic500(err);
            }
            return self.res.send(204);
        });
    }

    // Returns listing of server files.
    getServerDirectory() {
        const self = this;
        if (!Auth.allowed('s:files:get')) return;
        if (!this.req.params[0]) this.req.params[0] = '.';
        Auth.server().fs.directory(this.req.params[0], function getServerDirectoryListDirectory(err, data) {
            if (err) {
                Log.error(err);
                return Responses.generic500(err);
            }
            return self.res.send(data);
        });
    }
}

module.exports = RouteController;
