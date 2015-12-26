/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');

const Dockerode = require('dockerode');
const isStream = require('isstream');

const Status = rfr('lib/helpers/status.js');
const LoadConfig = rfr('lib/helpers/config.js');

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

class Docker {
    constructor(server, next) {
        this._server = server;
        this._containerID = this._server._json.container.id;
        this._container = DockerController.getContainer(this._containerID);
        this.stream = undefined;

        // Check status and attach if server is running currently.
        this.reattach(function constructorDocker(err, status) {
            return next(err, status);
        });
    }

    reattach(next) {
        const self = this;
        this.inspect(function dockerReattach(err, data) {
            if (err) return next(err);
            // We kind of have to assume that if the server is running it is on
            // and not in the process of booting or stopping.
            if (typeof data.State.Running !== 'undefined' && data.State.Running !== false) {
                self._server.status = Status.ON;
                self.attach(function (attachErr) {
                    return next(attachErr, (!attachErr));
                });
            } else {
                return next();
            }
        });
    }

    inspect(next) {
        this._container.inspect(function dockerInspect(err, data) {
            return next(err, data);
        });
    }

    /**
     * Starts a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    start(next) {
        this._server.status = Status.STARTING;
        this._container.start(function dockerStart(err) {
            // Container is already running, we can just continue on and pretend we started it just now.
            if (err && err.message.indexOf('HTTP code is 304 which indicates error: container already started') > -1) {
                return next();
            }
            return next(err);
        });
    }

    /**
     * Stops a given container and returns a callback when finished.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    stop(next) {
        this._container.stop(function dockerStop(err) {
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

    /**
     * Executes a command in the container requested.
     * @param  array    command
     * @param  function next
     * @return callback
     */
    exec(command, next) {
        const self = this;
        // Check if we are already attached. If we don't do this then we encounter issues
        // where the daemon thinks the container is crashed even if it is not. This
        // is due to the exec() function calling steamClosed()
        if (isStream(this.stream)) {
            return next(new Error('An active stream is already in use for this container.'));
        }

        this._container.exec({ Cmd: command, AttachStdin: true, AttachStdout: true, Tty: true }, function dockerExec(err, exec) {
            if (err) return next(err);
            exec.start(function dockerExecStartStart(execErr, stream) {
                if (!execErr && stream) {
                    stream.setEncoding('utf8');
                    stream.on('data', function dockerExecStreamData(data) {
                        // Send data to the Server.output() function.
                        self._server.output(data);
                    });
                    stream.on('end', function dockerExecStreamEnd() {
                        self._server.streamClosed();
                    });
                } else {
                    return next(execErr);
                }
            });
        });
    }

    /**
     * Writes input to the containers stdin.
     * @param  string   command
     * @param  {Function} next
     * @return {Callback}
     */
    write(command, next) {
        if (isStream.isWritable(this.stream)) {
            this.stream.write(command + '\n');
            return next();
        }
        return next(new Error('No writable stream was detected.'));
    }

    /**
     * Attaches to a container's stdin and stdout/stderr.
     * @param  {Function} next
     * @return {Callback}
     */
    attach(next) {
        const self = this;
        // Check if we are currently running exec(). If we don't do this then we encounter issues
        // where the daemon thinks the container is crashed even if it is not. Mostly an issue
        // with exec(), but still worth checking out here.
        if (typeof this.stream !== 'undefined' || isStream(this.stream)) {
            return next(new Error('An active stream is already in use for this container.'));
        }

        this._container.attach({ stream: true, stdin: true, stdout: true, stderr: true }, function dockerAttach(err, stream) {
            if (err) return next(err);
            self.stream = stream;
            self.stream.setEncoding('utf8');
            self.stream.on('data', function dockerAttachStreamData(data) {
                self._server.output(data);
            });
            self.stream.on('end', function dockerAttachStreamEnd() {
                self.stream = undefined;
                self._server.streamClosed();
            });
            return next();
        });
    }

}

module.exports = Docker;
