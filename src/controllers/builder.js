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
const Async = require('async');
const RandomString = require('randomstring');
const _ = require('lodash');

const Log = rfr('src/helpers/logger.js');
const ConfigHelper = rfr('src/helpers/config.js');
const SFTPController = rfr('src/controllers/sftp.js');
const InitializeHelper = rfr('src/helpers/initialize.js').Initialize;
const DeleteController = rfr('src/controllers/delete.js');

const Initialize = new InitializeHelper();
const Config = new ConfigHelper();
const SFTP = new SFTPController();

class Builder {

    constructor(json) {
        if (!json || !_.isObject(json) || json === null || !_.keys(json).length) {
            throw new Error('Invalid JSON was passed to Builder.');
        }
        this.json = json;
        this.log = Log.child({ server: this.json.uuid });
    }

    init(next) {
        Async.auto({
            verify_ip: callback => {
                this.log.debug('Updating passed JSON to route correct interfaces.');
                // Update 127.0.0.1 to point to the docker0 interface.
                if (this.json.build.default.ip === '127.0.0.1') {
                    this.json.build.default.ip = Config.get('docker.interface');
                }
                Async.forEachOf(this.json.build.ports, (ports, ip, asyncCallback) => {
                    if (ip === '127.0.0.1') {
                        this.json.build.ports[Config.get('docker.interface')] = ports;
                        delete this.json.build.ports[ip];
                        return asyncCallback();
                    }
                    return asyncCallback();
                }, callback);
            },
            create_sftp: callback => {
                this.log.debug('Creating SFTP user on the system...');
                SFTP.create(this.json.user, RandomString.generate(), callback);
            },
            set_uid: ['create_sftp', (results, callback) => {
                this.log.debug('Retrieving the user\'s ID...');
                SFTP.uid(this.json.user, (err, uid) => {
                    if (err || _.isNull(uid)) {
                        SFTP.delete(this.json.user, delErr => {
                            if (delErr) Log.fatal(delErr);
                            Log.warn('Cleaned up after failed server creation.');
                        });
                        return (!_.isNull(err)) ? callback(err) : callback(new Error('Unable to retrieve the user ID.'));
                    }
                    this.log.debug(`User ID is: ${uid}`);
                    this.json.build.user = parseInt(uid, 10);
                    return callback();
                });
            }],
            initialize: ['set_uid', 'verify_ip', (results, callback) => {
                Initialize.setup(this.json, callback);
            }],
            block_boot: ['initialize', (results, callback) => {
                results.initialize.blockStartup(true, callback);
            }],
            install_pack: ['block_boot', (results, callback) => {
                results.initialize.pack.install(callback);
            }],
            run_scripts: ['install_pack', (results, callback) => {
                if (_.get(this.json, 'service.skip_scripts', false)) {
                    this.log.info('Skipping service option script run due to server configuration file.');
                    return callback();
                }
                results.initialize.option.install(callback);
            }],
            unblock_boot: ['run_scripts', (results, callback) => {
                results.initialize.blockStartup(false, callback);
            }],
        }, err => {
            next(err, this.json);

            // Delete the server if there was an error causing this builder to abort.
            if (err) {
                const Delete = new DeleteController(this.json);
                Delete.delete(deleteError => {
                    if (deleteError) Log.error(deleteError);
                });
            }
        });
    }
}

module.exports = Builder;
