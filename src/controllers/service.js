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
                Log.info('Contacting panel to retrieve a list of currrent Eggs available to the node.');
                this.getServices(callback);
            },
            compare: ['services', (results, callback) => {
                Log.info('Checking existing eggs against Panel response...');

                const needsUpdate = [];
                Async.eachOf(results.services, (hash, uuid, loopCallback) => {
                    const currentFile = `./src/services/configs/${uuid}.json`;
                    Log.debug({ egg: uuid }, 'Checking that egg exists and is up-to-date.');
                    Fs.stat(currentFile, (err, stats) => {
                        if (err && err.code === 'ENOENT') {
                            needsUpdate.push(uuid);
                            return loopCallback();
                        } else if (err) { return loopCallback(err); }

                        if (!stats.isFile()) return loopCallback();

                        const currentChecksum = Crypto.createHash('sha1').update(Fs.readFileSync(currentFile), 'utf8').digest('hex');

                        if (currentChecksum !== hash) {
                            needsUpdate.push(uuid);
                        }

                        return loopCallback();
                    });
                }, err => {
                    callback(err, needsUpdate);
                });
            }],
            download: ['compare', (results, callback) => {
                if (_.isEmpty(results.compare)) return callback();

                Async.each(results.compare, (uuid, eCallback) => {
                    Log.debug({ egg: uuid }, 'Egg detected as missing or in need of update, pulling now.');
                    this.pullFile(uuid, eCallback);
                }, callback);
            }],
        }, next);
    }

    getServices(next) {
        const endpoint = `${Config.get('remote.base')}/api/remote/eggs`;
        Request({
            method: 'GET',
            url: endpoint,
            headers: {
                'Accept': 'application/vnd.pterodactyl.v1+json',
                'Authorization': `Bearer ${Config.get('keys.0')}`,
            },
        }, (err, response, body) => {
            if (err) return next(err);

            if (response.statusCode !== 200) {
                const error = new Error('Error while attempting to fetch list of Eggs from the panel.');
                error.responseCode = response.statusCode;
                error.requestURL = endpoint;
                return next(error);
            }

            try {
                return next(null, JSON.parse(body));
            } catch (ex) {
                return next(ex);
            }
        });
    }

    pullFile(uuid, next) {
        Log.debug({ egg: uuid }, 'Retrieving an updated egg from the Panel.');
        Request({
            method: 'GET',
            url: `${Config.get('remote.base')}/api/remote/eggs/${uuid}`,
            headers: {
                'Accept': 'application/vnd.pterodactyl.v1+json',
                'Authorization': `Bearer ${Config.get('keys.0')}`,
            },
        }, (err, response, body) => {
            if (err) return next(err);

            if (response.statusCode !== 200) {
                return next(new Error(`Error while attempting to fetch updated Egg file (HTTP/${response.statusCode})`));
            }

            Log.debug({ egg: uuid }, 'Writing new egg file to filesystem.');
            Fs.outputFile(`./src/services/configs/${uuid}.json`, body, next);
        });
    }
}

module.exports = Service;
