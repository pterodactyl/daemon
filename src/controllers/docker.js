/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');

const LoadConfig = rfr('lib/helpers/config.js');
const Dockerode = require('dockerode');

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', 'unix:///var/run/docker.sock'),
});

class Docker {
    constructor(container) {
        this._containerID = container;
        this._container = DockerController.getContainer(container);
    }

    /**
     * Starts a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    start(next) {
        this._container.start(function (err) {
            return next(err);
        });
    }

    /**
     * Stops a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    stop(next) {
        this._container.stop(function (err) {
            return next(err);
        });
    }

    /**
     * Kills a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    kill(next) {
        this._container.kill(function (err) {
            return next(err);
        });
    }

    rebuild() {
        //
    }
}

module.exports = Docker;
