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
const _ = require('lodash');
const Async = require('async');
const Fs = require('fs-extra');
const Cache = require('memory-cache');
const Request = require('request');
const Path = require('path');
const Crypto = require('crypto');
const Process = require('child_process');

const Log = rfr('src/helpers/logger.js');
const ConfigHelper = rfr('src/helpers/config.js');
const Config = new ConfigHelper();

class Pack {
    constructor(server) {
        this.server = server;
        this.pack = this.server.json.service.pack;
        this.archiveLocation = null;
        this.logger = Log;
        this.packdata = null;
    }

    // Called when a server is started and marked as needing a pack update
    // of some sort. Either due to being created, or a button click
    // from the panel or API that asks for an update.
    install(next) {
        if (_.isNil(this.pack) || _.isUndefined(this.pack)) {
            return next();
        }

        this.archiveLocation = Path.join(Config.get('pack.cache', './packs'), this.pack, 'archive.tar.gz');
        this.logger = Log.child({ pack: this.pack, server: this.server.json.uuid });

        Async.series([
            callback => {
                this.checkCache(callback);
            },
            callback => {
                this.unpackToServer(callback);
            },
        ], next);
    }

    checkCache(next) {
        // If pack is updating, just call this function every
        // second until it is done and then move on.
        if (!_.isNil(Cache.get(`pack.updating.${this.pack}`))) {
            setTimeout(() => {
                this.checkCache(next);
            }, 1000);
            return;
        }

        Cache.put(`pack.updating.${this.pack}`, true);
        this.logger.debug('Checking if pack needs to be updated.');
        Async.auto({
            file_exists: callback => {
                Fs.access(this.archiveLocation, (Fs.constants || Fs).R_OK, err => {
                    if (err && err.code === 'ENOENT') {
                        return callback(null, false);
                    }
                    return callback(err, true);
                });
            },
            local_hash: ['file_exists', (results, callback) => {
                if (!results.file_exists) return callback();

                this.logger.debug('Checking existing pack checksum.');
                const ChecksumStream = Fs.createReadStream(this.archiveLocation);
                const SHA1Hash = Crypto.createHash('sha1');
                ChecksumStream.on('data', data => {
                    SHA1Hash.update(data, 'utf8');
                });

                ChecksumStream.on('end', () => {
                    Cache.put(`pack.${this.pack}`, SHA1Hash.digest('hex'));
                    return callback();
                });

                ChecksumStream.on('error', callback);
            }],
            remote_hash: ['file_exists', (results, callback) => {
                if (!results.file_exists) return callback();

                this.logger.debug('Checking remote host for valid pack checksum.');
                const endpoint = `${Config.get('remote.base')}/daemon/packs/pull/${this.pack}/hash`;
                Request({
                    method: 'GET',
                    url: endpoint,
                    headers: {
                        'X-Access-Node': Config.get('keys.0'),
                    },
                }, (err, resp) => {
                    if (err) {
                        const error = new Error('Recieved a non-200 error code while attempting to pull the hash for a egg pack.');
                        error.responseCode = resp.statusCode;
                        error.requestURL = endpoint;
                        error.meta = err;
                        return callback(error);
                    }

                    if (resp.statusCode !== 200) {
                        return callback({
                            code: resp.statusCode,
                            body: resp.body,
                            pack: this.pack,
                        });
                    }

                    const Results = JSON.parse(resp.body);
                    return callback(null, Results['archive.tar.gz']);
                });
            }],
        }, (err, results) => {
            if (err) {
                this.logger.error(err, `Recieved a non-200 error code (${err.code}) when attempting to check a pack hash (${err.pack}).`);

                // Don't respond with error, packs are non-critical.
                return next();
            }

            if (results.file_exists) {
                if (Cache.get(`pack.${this.pack}`) === results.remote_hash) {
                    // Pack exists, and is valid.
                    this.logger.debug('Pack checksums are valid, not re-downloading.');
                    Cache.del(`pack.updating.${this.pack}`);
                    return next();
                }
            }

            Log.debug('Pack was not found on the system, or the hash was different. Downloading again.');
            if (results.file_exists) {
                this.logger.debug('Removing old pack from the system...');
                Fs.unlink(Path.join(Config.get('pack.cache', './packs'), this.pack, 'archive.tar.gz'), unlinkErr => {
                    if (unlinkErr) return next(unlinkErr);
                    this.downloadPack(next);
                });
            } else {
                this.downloadPack(next);
            }
        });
    }

    downloadPack(next) {
        // If no update is in progress, this function should
        // contact the panel and determine if the hash has changed.
        // If not, simply return and tell the checkCache() call that
        // eveything is good. If hash has changed, handle the update.
        //
        // Will need to run the request and hash check in parallel for speed.
        // Should compare the returned MD5 hash to the one we have stored.
        Async.series([
            callback => {
                Fs.ensureDir(Path.join(Config.get('pack.cache', './packs'), this.pack), callback);
            },
            callback => {
                Log.debug('Downloading pack...');
                const endpoint = `${Config.get('remote.base')}/daemon/packs/pull/${this.pack}`;
                Request({
                    method: 'GET',
                    url: endpoint,
                    headers: {
                        'X-Access-Node': Config.get('keys.0'),
                    },
                })
                    .on('error', next)
                    .on('response', response => {
                        if (response.statusCode !== 200) {
                            const error = new Error('Recieved a non-200 error code while attempting to pull the hash for a egg pack.');
                            error.responseCode = response.statusCode;
                            error.requestURL = endpoint;
                            error.pack = this.pack;
                            return next(error);
                        }
                    })
                    .pipe(Fs.createWriteStream(this.archiveLocation))
                    .on('close', callback);
            },
            callback => {
                Log.debug('Generating checksum...');
                const ChecksumStream = Fs.createReadStream(this.archiveLocation);
                const SHA1Hash = Crypto.createHash('sha1');
                ChecksumStream.on('data', data => {
                    SHA1Hash.update(data, 'utf8');
                });

                ChecksumStream.on('end', () => {
                    Cache.put(`pack.${this.pack}`, SHA1Hash.digest('hex'));
                    return callback();
                });
            },
            callback => {
                Log.debug('Downlaod complete, moving on.');
                Cache.del(`pack.updating.${this.pack}`);
                return callback();
            },
        ], next);
    }

    unpackToServer(next) {
        this.logger.debug('Unpacking pack to server.');
        const Exec = Process.spawn('tar', ['-xzf', Path.basename(this.archiveLocation), '-C', this.server.path()], {
            cwd: Path.dirname(this.archiveLocation),
            uid: Config.get('docker.container.user', 1000),
            gid: Config.get('docker.container.user', 1000),
        });

        Exec.on('error', execErr => {
            this.logger.error(execErr);
            return next(new Error('There was an error while attempting to decompress this file.'));
        });
        Exec.on('exit', (code, signal) => {
            if (code !== 0) {
                this.logger.error(`Decompression of file exited with code ${code} signal ${signal}.`);
            }

            return next();
        });
    }
}

module.exports = Pack;
