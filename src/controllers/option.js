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
const Dockerode = require('dockerode');
const Async = require('async');
const Request = require('request');
const Fs = require('fs-extra');
const Path = require('path');
const Util = require('util');
const _ = require('lodash');
const isStream = require('isstream');
const createOutputStream = require('create-output-stream');

const ConfigHelper = rfr('src/helpers/config.js');
const ImageHelper = rfr('src/helpers/image.js');

const Config = new ConfigHelper();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

class Option {
    constructor(server) {
        this.server = server;
        this.processLogger = undefined;
    }

    pull(next) {
        this.server.log.debug('Contacting panel to determine scripts to run for option processes.');

        const endpoint = `${Config.get('remote.base')}/api/remote/scripts/${this.server.json.uuid}`;
        Request({
            method: 'GET',
            url: endpoint,
            timeout: 5000,
            headers: {
                'Accept': 'application/vnd.pterodactyl.v1+json',
                'Authorization': `Bearer ${Config.get('keys.0')}`,
            },
        }, (err, resp) => {
            if (err) return next(err);
            if (resp.statusCode !== 200) {
                const error = new Error('Recieved a non-200 error code when attempting to check scripts for server.');
                error.meta = {
                    code: resp.statusCode,
                    requestUrl: endpoint,
                };
                return next(error);
            }

            const Results = JSON.parse(resp.body);
            return next(null, Results);
        });
    }

    install(next) {
        this.server.log.info('Blocking server boot until option installation process is completed.');
        this.server.blockBooting = true;

        Async.auto({
            details: callback => {
                this.server.log.debug('Contacting remote server to pull scripts to be used.');
                this.pull(callback);
            },
            write_file: ['details', (results, callback) => {
                if (_.isNil(_.get(results.details, 'scripts.install', null))) {
                    // No script defined, skip the rest.
                    const error = new Error('No installation script was defined for this egg, skipping rest of process.');
                    error.code = 'E_NOSCRIPT';
                    return callback(error);
                }

                this.server.log.debug('Writing temporary file to be handed into the Docker container.');
                Fs.outputFile(Path.join('/tmp/pterodactyl/', this.server.json.uuid, '/install.sh'), results.details.scripts.install, {
                    mode: '0o644',
                    encoding: 'utf8',
                }, callback);
            }],
            image: ['write_file', (results, callback) => {
                const PullImage = _.get(results.details, 'config.container', 'alpine:3.4');
                this.server.log.debug(`Pulling ${PullImage} image if it is not already on the system.`);
                ImageHelper.pull(PullImage, callback);
            }],
            close_stream: ['write_file', (results, callback) => {
                if (isStream.isWritable(this.processLogger)) {
                    this.processLogger.close();
                    this.processLogger = undefined;
                    return callback();
                }
                return callback();
            }],
            setup_stream: ['close_stream', (results, callback) => {
                const LoggingLocation = Path.join(this.server.configDataLocation, 'install.log');
                this.server.log.info('Writing output of installation process to file.', { file: LoggingLocation });
                this.processLogger = createOutputStream(LoggingLocation, {
                    mode: '0o644',
                    defaultEncoding: 'utf8',
                });
                return callback();
            }],
            suspend: ['image', (results, callback) => {
                this.server.log.info('Temporarily suspending server to avoid mishaps...');
                this.server.suspend(callback);
            }],
            run: ['setup_stream', 'image', (results, callback) => {
                this.server.log.debug('Running privileged docker container to perform the installation process.');

                const environment = [];
                environment.push(`SERVER_MEMORY=${this.server.json.build.memory}`);
                environment.push(`SERVER_IP=${this.server.json.build.default.ip}`);
                environment.push(`SERVER_PORT=${this.server.json.build.default.port}`);
                _.forEach(_.get(results.details, 'env', []), (value, key) => {
                    environment.push(`${key}=${value}`);
                });

                DockerController.run(_.get(results.details, 'config.container', 'alpine:3.4'), [_.get(results.details, 'config.entry', 'ash'), './mnt/install/install.sh'], (Config.get('logger.level', 'info') === 'debug') ? process.stdout : this.processLogger, {
                    Tty: true,
                    AttachStdin: true,
                    AttachStdout: true,
                    AttachStderr: true,
                    Env: environment,
                    Mounts: [
                        {
                            Source: this.server.path(),
                            Destination: '/mnt/server',
                            RW: true,
                        },
                        {
                            Source: Path.join('/tmp/pterodactyl/', this.server.json.uuid),
                            Destination: '/mnt/install',
                            RW: true,
                        },
                    ],
                    HostConfig: {
                        Privileged: _.get(results.details, 'scripts.privileged', false),
                        Binds: [
                            Util.format('%s:/mnt/server', this.server.path()),
                            Util.format('%s:/mnt/install', Path.join('/tmp/pterodactyl/', this.server.json.uuid)),
                        ],
                    },
                }, (err, data, container) => {
                    if (_.isObject(container) && _.isFunction(_.get(container, 'remove', null))) {
                        container.remove();
                    }

                    if (err) {
                        return callback(err);
                    }

                    this.server.log.info('Completed installation process for server.');
                    this.server.blockBooting = false;
                    callback(err, data);
                });
            }],
            close_logger: ['run', (results, callback) => {
                if (isStream.isWritable(this.processLogger)) {
                    this.processLogger.close();
                    this.processLogger = undefined;
                }
                return callback();
            }],
            remove_install_script: ['run', (results, callback) => {
                Fs.unlink(Path.join('/tmp/pterodactyl/', this.server.json.uuid, '/install.sh'), callback);
            }],
            chown: ['run', (results, callback) => {
                this.server.log.debug('Properly chowning all server files and folders after installation.');
                this.server.fs.chown('/', callback);
            }],
        }, err => {
            this.server.unsuspend(() => { _.noop(); });

            // No script, no need to kill everything.
            if (err && err.code === 'E_NOSCRIPT') {
                this.server.log.info(err.message);
                return next();
            }

            return next(err);
        });
    }
}

module.exports = Option;
