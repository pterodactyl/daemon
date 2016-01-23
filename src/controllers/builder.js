'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2016 Dane Everitt <dane@daneeveritt.com>
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
const Fs = require('fs-extra');
const Path = require('path');
const Dockerode = require('dockerode');
const Util = require('util');
const RandomString = require('randomstring');
const _ = require('underscore');

const Log = rfr('src/helpers/logger.js');
const ImageHelper = rfr('src/helpers/image.js');
const InitializeHelper = rfr('src/helpers/initialize.js').Initialize;
const ConfigHelper = rfr('src/helpers/config.js');
const SFTPController = rfr('src/controllers/sftp.js');

const Config = new ConfigHelper();
const SFTP = new SFTPController();
const ServerInitializer = new InitializeHelper();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

class Builder {

    constructor(json) {
        if (!json || typeof json !== 'object' || json === null || !Object.keys(json).length) {
            throw new Error('Invalid JSON was passed to Builder.');
        }
        this.json = json;
        this.log = Log.child({ server: this.json.uuid });
    }

    init(next) {
        const self = this;
        // @TODO: validate everything needed is here in the JSON.
        Async.series([
            function initAsyncSetupSFTP(callback) {
                self.log.info('Creating SFTP user on the system...');
                SFTP.create(self.json.user, RandomString.generate(), function (err) {
                    return callback(err);
                });
            },
            function initAsyncGetUser(callback) {
                self.log.info('Retrieving the user\'s ID...');
                SFTP.uid(self.json.user, function (err, uid) {
                    if (err || uid === null) {
                        SFTP.delete(self.json.user, function (delErr) {
                            if (delErr) Log.fatal(delErr);
                            Log.warn('Cleaned up after failed server creation.');
                        });
                        return (err !== null) ? callback(err) : callback(new Error('Unable to retrieve the user ID.'));
                    }
                    self.log.info('User ID is: ' + uid);
                    self.json.build.user = parseInt(uid, 10);
                    return callback();
                });
            },
            function initAsyncBuildContainer(callback) {
                self.log.info('Building container for server');
                self.buildContainer(self.json.uuid, function (err, data) {
                    if (err) {
                        SFTP.delete(self.json.user, function (delErr) {
                            if (delErr) Log.fatal(delErr);
                            Log.warn('Cleaned up after failed server creation.');
                        });
                        return callback(err);
                    }
                    self.json.container = {};
                    self.json.container.id = data.id.substr(0, 12);
                    self.json.container.image = data.image;
                    return callback();
                });
            },
            function initAsyncWriteConfig(callback) {
                self.log.info('Writing configuration to disk...');
                self.writeConfigToDisk(function (err) {
                    if (err) {
                        Async.parallel([
                            function (parallelCallback) {
                                SFTP.delete(self.json.user, function (asyncErr) {
                                    if (asyncErr) Log.fatal(err);
                                    return parallelCallback();
                                });
                            },
                            function (parallelCallback) {
                                const container = DockerController.getContainer(self.json.container.id);
                                container.remove(function (asyncErr) {
                                    if (asyncErr) Log.fatal(asyncErr);
                                    return parallelCallback();
                                });
                            },
                        ], function () {
                            Log.warn('Cleaned up after failed server creation.');
                        });
                    }
                    return callback(err);
                });
            },
            function initAsyncInitialize(callback) {
                ServerInitializer.setup(self.json, function (err) {
                    if (err) {
                        Async.parallel([
                            function (parallelCallback) {
                                SFTP.delete(self.json.user, function (asyncErr) {
                                    if (asyncErr) Log.fatal(err);
                                    return parallelCallback();
                                });
                            },
                            function (parallelCallback) {
                                const container = DockerController.getContainer(self.json.container.id);
                                container.remove(function (asyncErr) {
                                    if (asyncErr) Log.fatal(asyncErr);
                                    return parallelCallback();
                                });
                            },
                            function (parallelCallback) {
                                Fs.remove(Path.join('./config/servers', this.json.uuid, '/server.json'), function (asyncErr) {
                                    if (asyncErr) Log.fatal(asyncErr);
                                    return parallelCallback();
                                });
                            },
                        ], function () {
                            Log.warn('Cleaned up after failed server creation.');
                        });
                    }
                    return callback(err);
                });
            },
        ], function initAsyncCallback(err) {
            return next(err, self.json);
        });
    }

    writeConfigToDisk(next) {
        if (typeof this.json.uuid === 'undefined') {
            return next(new Error('No UUID was passed properly in the JSON recieved.'));
        }
        // Attempt to write to disk, return error if failed, otherwise return nothing.
        Fs.outputJson(Path.join('./config/servers', this.json.uuid, '/server.json'), this.json, function writeConfigWrite(err) {
            return next(err);
        });
    }

    buildContainer(json, next) {
        const self = this;
        const config = this.json.build;
        const bindings = {};
        const exposed = {};
        Async.series([
            function (callback) {
                // The default is to not automatically update images.
                if (Config.get('docker.autoupdate_images', false) === false) {
                    ImageHelper.exists(config.image, function (err) {
                        if (!err) return callback();
                        Log.info(Util.format('Pulling image %s because it doesn\'t exist on the system.', config.image));
                        ImageHelper.pull(config.image, function (pullErr) {
                            return callback(pullErr);
                        });
                    });
                } else {
                    ImageHelper.pull(config.image, function (err) {
                        return callback(err);
                    });
                }
            },
            function (callback) {
                // Build the port bindings
                Async.forEachOf(config.ports, function (ports, ip, eachCallback) {
                    Async.each(ports, function (port, portCallback) {
                        bindings[Util.format('%s/tcp', port)] = [{
                            'HostIp': ip,
                            'HostPort': port.toString(),
                        }];
                        bindings[Util.format('%s/udp', port)] = [{
                            'HostIp': ip,
                            'HostPort': port.toString(),
                        }];
                        exposed[Util.format('%s/tcp', port)] = {};
                        exposed[Util.format('%s/udp', port)] = {};
                        portCallback();
                    }, function () {
                        eachCallback();
                    });
                }, function () {
                    return callback();
                });
            },
            function (callback) {
                // Add some additional environment variables
                config.env.SERVER_MEMORY = config.memory;
                config.env.SERVER_IP = config.default.ip;
                config.env.SERVER_PORT = config.default.port;

                const environment = [];
                _.each(config.env, function (value, index) {
                    environment.push(Util.format('%s=%s', index, value));
                });

                // Make the container
                DockerController.createContainer({
                    Image: config.image,
                    Hostname: 'container',
                    User: config.user.toString(),
                    AttachStdin: true,
                    AttachStdout: true,
                    AttachStderr: true,
                    OpenStdin: true,
                    Tty: true,
                    Mounts: [
                        {
                            Source: Path.join(Config.get('sftp.path', '/srv/data'), self.json.user, '/data'),
                            Destination: '/home/container',
                            RW: true,
                        },
                    ],
                    Env: environment,
                    ExposedPorts: exposed,
                    HostConfig: {
                        Binds: [
                            Util.format('%s:/home/container', Path.join(Config.get('sftp.path', '/srv/data'), self.json.user, '/data')),
                        ],
                        PortBindings: bindings,
                        OomKillDisable: config.oom_disabled || false,
                        CpuQuota: (config.cpu > 0) ? (config.cpu * 1000) : -1,
                        CpuPeriod: (config.cpu > 0) ? 100000 : 0,
                        Memory: config.memory * 1000000,
                        BlkioWeight: config.io,
                        Dns: [
                            '8.8.8.8',
                            '8.8.4.4',
                        ],
                    },
                }, function (err, container) {
                    return callback(err, container);
                });
            },
        ], function (err, data) {
            if (err) return next(err);
            return next(null, {
                id: data[2].id,
                image: config.image,
            });
        });
    }

}

module.exports = Builder;
