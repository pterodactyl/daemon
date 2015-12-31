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
const Dockerode = require('dockerode');
const Fs = require('fs-extra');
const Path = require('path');

const SFTPController = rfr('src/controllers/sftp.js');
const ConfigHelper = rfr('src/helpers/config.js');
const Log = rfr('src/helpers/logger.js');

const Config = new ConfigHelper();
const SFTP = new SFTPController();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

class Delete {
    constructor(json) {
        this.json = json;
        this.log = Log.child({ server: this.json.uuid });
    }

    delete(next) {
        const self = this;
        Async.series([
            // Clear the 'Servers' object of the specific server
            function (callback) {
                self.log.info('Clearing servers object...');
                const Servers = rfr('src/helpers/initialize.js').Servers;
                delete Servers[self.json.uuid];
                return callback();
            },
            // Delete the container (kills if running)
            function (callback) {
                self.log.info('Attempting to remove container...');
                const container = DockerController.getContainer(self.json.container.id);
                container.remove({ v: true, force: true }, function (err) {
                    if (!err) self.log.info('Removed container.');
                    return callback(err);
                });
            },
            // Delete the SFTP user and files.
            function (callback) {
                self.log.info('Attempting to remove SFTP user...');
                SFTP.delete(self.json.user, function (err) {
                    if (!err) self.log.info('Removed SFTP user.');
                    return callback(err);
                });
            },
            // Delete the configuration files for this server
            function (callback) {
                self.log.info('Attempting to remove configuration files...');
                Fs.remove(Path.join('./config/servers', self.json.uuid), function (err) {
                    if (!err) self.log.info('Removed configuration folder.');
                    return callback(err);
                });
            },
        ], function (err) {
            if (err) Log.fatal(err);
            return next(err);
        });
    }
}

module.exports = Delete;
