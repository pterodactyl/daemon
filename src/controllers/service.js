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
const Request = require('request');
const Async = require('async');
const Fs = require('fs-extra');
const Crypto = require('crypto');
const _ = require('lodash');

const Log = rfr('src/helpers/logger.js');
const ConfigHelper = rfr('src/helpers/config.js');

const Config = new ConfigHelper();

class Service {
    boot(next) {
        Async.auto({
            services: callback => {
                Log.info('Contacting panel to retrieve a list of currrent services available to the node.');
                this.getServices(callback);
            },
            compare: ['services', (results, callback) => {
                Log.info('Checking current files aganist panel response.');

                const needsUpdate = [];
                Async.eachOf(results.services, (hashes, service, eCallback) => {
                    Async.eachOf(hashes, (hash, file, iCallback) => {
                        const currentFile = `./src/services/${service}/${file}`;
                        Fs.stat(currentFile, (err, stats) => {
                            if (err && err.code === 'ENOENT') {
                                needsUpdate.push(`${service}/${file}`);
                                return iCallback();
                            } else if (err) { return iCallback(err); }

                            if (!stats.isFile()) return iCallback();

                            const currentChecksum = Crypto.createHash('sha1').update(Fs.readFileSync(currentFile), 'utf8').digest('hex');

                            if (currentChecksum !== hash) {
                                needsUpdate.push(`${service}/${file}`);
                            }

                            return iCallback();
                        });
                    }, eCallback);
                }, err => {
                    callback(err, needsUpdate);
                });
            }],
            download: ['compare', (results, callback) => {
                if (_.isEmpty(results.compare)) return callback();

                Async.each(results.compare, (file, eCallback) => {
                    this.pullFile(file, eCallback);
                }, callback);
            }],
        }, next);
    }

    getServices(next) {
        Request.get(`${Config.get('remote.base')}/daemon/services`, (err, response, body) => {
            if (err) return next(err);

            if (response.statusCode !== 200) {
                return next(new Error(`Error while attempting to fetch list of services (HTTP/${response.statusCode})`));
            }

            try {
                return next(null, JSON.parse(body));
            } catch (ex) {
                return next(ex);
            }
        });
    }

    pullFile(file, next) {
        Log.debug(`Pulling updated service file: ${file}`);
        Request.get(`${Config.get('remote.base')}/daemon/services/pull/${file}`, (err, response, body) => {
            if (err) return next(err);

            if (response.statusCode !== 200) {
                return next(new Error(`Error while attempting to fetch updated service file (HTTP/${response.statusCode})`));
            }

            Log.debug(`Saving updated service file: ${file}`);
            Fs.outputFile(`./src/services/${file}`, body, next);
        });
    }
}

module.exports = Service;
