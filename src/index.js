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
const Proc = require('child_process');
const Request = require('request');
const compareVersions = require('compare-versions');
const Fs = require('fs-extra');
const _ = require('lodash');
const Keypair = require('keypair');
const Getos = require('getos');

const Log = rfr('src/helpers/logger.js');
const Package = rfr('package.json');
const ConfigHelper = rfr('src/helpers/config.js');
const Config = new ConfigHelper();

Log.info('+ ------------------------------------ +');
Log.info(`| Running Pterodactyl Daemon v${Package.version}    |`);
Log.info('|        https://pterodactyl.io        |');
Log.info('|  Copyright 2015 - 2018 Dane Everitt  |');
Log.info('+ ------------------------------------ +');
Log.info('Loading modules, this could take a few seconds.');

const NetworkController = rfr('src/controllers/network.js');
const Initializer = rfr('src/helpers/initialize.js').Initialize;
const LiveStats = rfr('src/http/stats.js');
const ServiceController = rfr('src/controllers/service.js');
const TimezoneHelper = rfr('src/helpers/timezone.js');
const SftpServer = rfr('src/http/sftp.js');

const Network = new NetworkController();
const Initialize = new Initializer();
const Stats = new LiveStats();
const Service = new ServiceController();
const Timezone = new TimezoneHelper();
const Sftp = new SftpServer();

Log.info('Modules loaded, starting Pterodactyl Daemon...');
Async.auto({
    check_version: callback => {
        if (Package.version === '0.0.0-canary') {
            return callback(null, 'Pterodactyl Daemon is up-to-date running a nightly build.');
        }

        Request.get('https://cdn.pterodactyl.io/releases/latest.json', {
            timeout: 5000,
        }, (err, response, body) => {
            if (err) {
                return callback(null, ['An error occurred while attempting to check the latest daemon release version.']);
            }

            if (response.statusCode === 200) {
                const json = JSON.parse(body);

                if (compareVersions(Package.version, json.daemon) >= 0) {
                    return callback(null, 'Pterodactyl Daemon is up-to-date!');
                }

                return callback(null, [
                    '+ ---------------------------- WARNING! ---------------------------- +',
                    'Pterodactyl Daemon is not up-to-date!',
                    '',
                    `Installed: v${Package.version}`,
                    `   Stable: v${json.daemon}`,
                    `  Release: https://github.com/Pterodactyl/Daemon/releases/v${json.daemon}`,
                    '+ ------------------------------------------------------------------ +',
                ]);
            }

            return callback(null, ['Unable to check if this daemon is up to date! Invalid status code returned.']);
        });
    },
    check_structure: callback => {
        Fs.ensureDirSync('config/servers');
        Fs.ensureDirSync('config/.sftp');
        Fs.ensureDirSync(Config.get('filesystem.server_logs', '/tmp/pterodactyl'));

        callback();
    },
    check_tar: callback => {
        Proc.exec('tar --help', {}, callback);
        Log.debug('Tar module found on server.');
    },
    check_zip: callback => {
        Proc.exec('unzip --help', {}, callback);
        Log.debug('Unzip module found on server.');
    },
    check_sftp_rsa_key: callback => {
        Log.debug('Checking for SFTP id_rsa key...');
        Fs.stat('./config/.sftp/id_rsa', err => {
            if (err && err.code === 'ENOENT') {
                Log.info('Creating keypair to use for SFTP connections.');

                const pair = Keypair({
                    bits: Config.get('sftp.keypair.bits', 2048),
                    e: Config.get('sftp.keypair.e', 65537),
                });
                Async.parallel([
                    pcall => {
                        Fs.outputFile('./config/.sftp/id_rsa', pair.private, {
                            mode: 0o600,
                        }, pcall);
                    },
                    pcall => {
                        Fs.outputFile('./config/.sftp/id_rsa.pub', pair.public, {
                            mode: 0o600,
                        }, pcall);
                    },
                ], callback);
            } else if (err) {
                return callback(err);
            } else {
                return callback();
            }
        });
    },
    setup_sftp_user: ['check_structure', 'check_tar', 'check_zip', (r, callback) => {
        Log.debug('Checking if a SFTP user needs to be created and assigned to the configuration.');
        Async.waterfall([
            scall => {
                Log.debug(`Checking if user ${Config.get('docker.container.username', 'pterodactyl')} exists or needs to be created.`);
                Proc.exec(`cat /etc/passwd | grep ${Config.get('docker.container.username', 'pterodactyl')}`, {}, (err, stdout) => {
                    // grep outputs exit code 1 with no output when
                    // nothing is matched.
                    if (err && err.code === 1 && _.isEmpty(stdout)) {
                        return scall(null, false);
                    }

                    scall(err, !_.isEmpty(stdout));
                });
            },
            (exists, scall) => {
                Getos((err, os) => {
                    scall(err, exists, os);
                });
            },
            (exists, os, scall) => {
                if (exists) {
                    return scall();
                }

                let UserCommand = '';
                const Username = Config.get('docker.container.username', 'pterodactyl');

                switch (_.get(os, 'dist')) {
                case 'Alpine Linux':
                    UserCommand = `addgroup -S ${Username} && adduser -S -D -H -G ${Username} -s /bin/false ${Username}`;
                    break;
                case 'Ubuntu Linux':
                case 'Debian':
                case 'Centos':
                    UserCommand = `useradd --system --no-create-home --shell /bin/false ${Username}`;
                    break;
                default:
                    return scall(new Error('Unable to create a pterodactyl user and group, unknown operating system.'));
                }

                Proc.exec(UserCommand, {}, err => {
                    if (err && (!_.includes(err.message, 'already exists') || !_.includes(err.message, `user '${Username}' in use`))) {
                        return scall(err);
                    }

                    return scall();
                });
            },
            scall => {
                Proc.exec(`id -u ${Config.get('docker.container.username', 'pterodactyl')}`, {}, (err, stdout) => {
                    if (err) return scall(err);

                    Log.info(`Configuring user ${Config.get('docker.container.username', 'pterodactyl')} (id: ${stdout.replace(/[\x00-\x1F\x7F-\x9F]/g, '')}) as the owner of all server files.`); // eslint-disable-line
                    Config.modify({
                        docker: {
                            container: {
                                user: parseInt(stdout.replace(/[\x00-\x1F\x7F-\x9F]/g, ''), 10), // eslint-disable-line
                            },
                        },
                    }, scall);
                });
            },
        ], callback);
    }],
    setup_timezone: ['setup_sftp_user', (r, callback) => {
        Log.info('Configuring timezone file location...');
        Timezone.configure(callback);
    }],
    check_network: ['setup_timezone', (r, callback) => {
        Log.info('Checking container networking environment...');
        Network.init(callback);
    }],
    setup_network: ['check_network', (r, callback) => {
        Log.info('Ensuring correct network interface for containers...');
        Network.interface(callback);
    }],
    check_services: ['setup_network', (r, callback) => {
        Service.boot(callback);
    }],
    init_servers: ['check_services', (r, callback) => {
        Log.info('Beginning server initialization process.');
        Initialize.init(callback);
    }],
    configure_perms: ['init_servers', (r, callback) => {
        const Servers = rfr('src/helpers/initialize.js').Servers;
        Async.each(Servers, (Server, loopCallback) => {
            Server.setPermissions(err => {
                if (err) {
                    Server.log.warn('Unable to assign permissions on startup for this server. Are all of the files in the correct location?');
                }
                loopCallback();
            });
        }, callback);
    }],
    init_websocket: ['init_servers', (r, callback) => {
        Log.info('Configuring websocket for daemon stats...');
        Stats.init();
        return callback();
    }],
    init_sftp: ['init_websocket', 'check_sftp_rsa_key', (r, callback) => {
        Log.info('Configuring internal SFTP server...');
        Sftp.init(callback);
    }],
}, (err, results) => {
    if (err) {
        // Log a fatal error and exit.
        // We need this to initialize successfully without any errors.
        Log.fatal({ err, additional: err }, 'A fatal error caused the daemon to abort the startup.');
        if (err.code === 'ECONNREFUSED') {
            Log.fatal('+ ------------------------------------ +');
            Log.fatal('|  Docker is not running!              |');
            Log.fatal('|                                      |');
            Log.fatal('|  Unable to locate a suitable socket  |');
            Log.fatal('|  at path specified in configuration. |');
            Log.fatal('+ ------------------------------------ +');
        }

        Log.error('You should forcibly quit this process (CTRL+C) and attempt to fix the issue.');
    } else {
        rfr('src/http/routes.js');

        if (!_.isUndefined(results.check_version)) {
            if (_.isString(results.check_version)) {
                Log.info(results.check_version);
            } else if (_.isArray(results.check_version)) {
                _.forEach(results.check_version, line => { Log.warn(line); });
            }
        }
    }
});

process.on('uncaughtException', err => {
    Log.fatal(err, 'A fatal error occured during an operation.');
});

process.on('SIGUSR2', () => {
    Log.reopenFileStreams();
});
