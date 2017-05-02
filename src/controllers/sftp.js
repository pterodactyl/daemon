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
const Path = require('path');
const Util = require('util');
const Async = require('async');
const Dockerode = require('dockerode');
const _ = require('lodash');

const LoadConfig = rfr('src/helpers/config.js');
const Log = rfr('src/helpers/logger.js');
const ImageHelper = rfr('src/helpers/image.js');

const SFTP_DOCKER_IMAGE = 'quay.io/pterodactyl/scrappy:latest';

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

class SFTP {
    constructor(init) {
        if (_.isUndefined(init)) {
            this.container = DockerController.getContainer(Config.get('sftp.container'));
        } else {
            this.container = undefined;
        }
    }

    buildContainer(next) {
        Async.waterfall([
            callback => {
                if (Config.get('docker.autoupdate_images', false) === false) {
                    ImageHelper.exists(SFTP_DOCKER_IMAGE, err => {
                        if (!err) return callback();
                        Log.info(`Pulling SFTP container image ${SFTP_DOCKER_IMAGE} because it doesn't exist on the system.`);
                        ImageHelper.pull(SFTP_DOCKER_IMAGE, callback);
                    });
                } else {
                    Log.info(`Checking if we need to update the SFTP container image ${SFTP_DOCKER_IMAGE}, if so it will happen now.`);
                    ImageHelper.pull(SFTP_DOCKER_IMAGE, callback);
                }
            },
            callback => {
                DockerController.createContainer({
                    Image: SFTP_DOCKER_IMAGE,
                    Hostname: 'ptdlsftp',
                    AttachStdin: true,
                    AttachStdout: true,
                    AttachStderr: true,
                    OpenStdin: true,
                    Tty: true,
                    Mounts: [
                        {
                            Source: Config.get('sftp.path', '/srv/data'),
                            Destination: '/sftp-root',
                            RW: true,
                        },
                        {
                            Source: Path.join(Path.dirname(require.main.filename), '../config/credentials'),
                            Destination: '/creds',
                            RW: true,
                        },
                    ],
                    ExposedPorts: {
                        '22/tcp': {},
                    },
                    HostConfig: {
                        Binds: [
                            Util.format('%s:/sftp-root', Config.get('sftp.path', '/srv/data')),
                            Util.format('%s:/creds', Path.join(Path.dirname(require.main.filename), '../config/credentials')),
                        ],
                        PortBindings: {
                            '22/tcp': [
                                {
                                    'HostPort': Config.get('sftp.port', '2022').toString(),
                                },
                            ],
                        },
                        Dns: [
                            '8.8.8.8',
                            '8.8.4.4',
                        ],
                    },
                }, (err, container) => {
                    callback(err, container);
                });
            },
            (containerInfo, callback) => {
                Config.modify({
                    'sftp': {
                        'container': containerInfo.id,
                    },
                }, callback);
            },
        ], next);
    }

    /**
     * Starts the SFTP container on the system.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    startService(next) {
        Async.series([
            callback => {
                if (!_.isUndefined(Config.get('sftp.container'))) {
                    DockerController.listContainers({ 'all': 1 }, (err, containers) => {
                        if (err) return callback(err);
                        let foundContainer;

                        // Attempt to find container by ID
                        foundContainer = _.find(containers, values => {
                            if (_.startsWith(values.Id, Config.get('sftp.container'))) return true;
                        });

                        // Couldn't locate by ID, lets try looking for the SFTP image itself.
                        if (_.isUndefined(foundContainer)) {
                            Log.debug('Unable to locate suitable SFTP container by assigned ID, attempting to locate by image name.');
                            foundContainer = _.find(containers, values => {
                                if (values.Image === SFTP_DOCKER_IMAGE) return true;
                            });
                        }

                        if (!_.isUndefined(foundContainer)) {
                            this.container = DockerController.getContainer(foundContainer.Id);
                            Config.modify({
                                'sftp': {
                                    'container': this.container.id,
                                },
                            }, callback);
                        } else {
                            return callback();
                        }
                    });
                } else {
                    return callback();
                }
            },
            callback => {
                if (_.isUndefined(this.container)) {
                    Log.warn('Unable to locate a suitable SFTP container in the configuration, creating one now.');
                    this.buildContainer(err => {
                        if (err) return callback(err);
                        this.container = DockerController.getContainer(Config.get('sftp.container'));
                        return callback();
                    });
                } else {
                    return callback();
                }
            },
            callback => {
                this.container.start(err => {
                    // Container is already running, we can just continue on and pretend we started it just now.
                    if (err && _.includes(err.message, 'container already started')) {
                        return callback();
                    }
                    return callback(err);
                });
            },
        ], next);
    }

    /**
     * Creates a new SFTP user on the system.
     * @param  string     username
     * @param  password   password
     * @param  {Function} next
     * @return {Callback}
     */
    create(username, password, next) {
        this.doExec(['scrappyuser', '-u', username, '-p', password], next);
    }

    /**
     * Updates the password for a SFTP user on the system.
     * @param  string     username
     * @param  string   password
     * @param  {Function} next
     * @return {Callback}
     */
    password(username, password, next) {
        this.doExec(['scrappypwd', '-u', username, '-p', password], next);
    }

    /**
     * Gets the UID for a specified user.
     * @param  string   username
     * @param  {Function} next
     * @return {[type]}]
     */
    uid(username, next) {
        this.doExec(['id', '-u', username], (err, userid) => {
            next(err, userid);
        });
    }

    /**
     * Deletes the specified user and folders from the container.
     * @param  string   username
     * @param  {Function} next
     * @return {[type]}]
     */
    delete(username, next) {
        this.doExec(['scrappydel', '-u', username], next);
    }

    /**
     * Locks an account to prevent SFTP access. Used for server suspension.
     * @param   string    username
     * @param   {Function} next
     * @return  void
     */
    lock(username, next) {
        this.doExec(['passwd', '-l', username], next);
    }

    /**
     * Unlocks an account to allow SFTP access. Used for server unsuspension.
     * @param   string    username
     * @param   {Function} next
     * @return  void
     */
    unlock(username, next) {
        this.doExec(['passwd', '-u', username], next);
    }

    /**
     * Handles passing execution to the container for create and password.
     * @param  array     command
     * @param  {Function} next
     * @return {Callback}
     */
    doExec(command, next) {
        let uidResponse = null;
        this.container.exec({
            Cmd: command,
            AttachStdin: true,
            AttachStdout: true,
            Tty: true,
        }, (err, exec) => {
            if (err) return next(err);
            exec.start((execErr, stream) => {
                if (!execErr && stream) {
                    stream.setEncoding('utf8');
                    stream.on('data', data => {
                        if (/^(\d{5})$/.test(data.replace(/[\x00-\x1F\x7F-\x9F]/g, ''))) { // eslint-disable-line
                            uidResponse = data.replace(/[\x00-\x1F\x7F-\x9F]/g, ''); //eslint-disable-line
                        }
                    });
                    stream.on('end', () => {
                        exec.inspect((inspectErr, data) => {
                            if (inspectErr) return next(inspectErr);
                            if (data.ExitCode !== 0) {
                                return next(new Error('Docker returned a non-zero exit code when attempting to execute a SFTP command.'), {
                                    exec: command,
                                    code: data.ExitCode,
                                });
                            }
                            return next(null, uidResponse);
                        });
                    });
                } else {
                    return next(execErr);
                }
            });
        });
    }
}

module.exports = SFTP;
