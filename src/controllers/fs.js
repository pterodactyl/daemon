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
const Fs = require('fs-extra');
const Async = require('async');
const Path = require('path');
const Chokidar = require('chokidar');
const _ = require('lodash');
const Mmm = require('mmmagic');

const Magic = Mmm.Magic;

class FileSystem {
    constructor(server) {
        this.server = server;

        const Watcher = Chokidar.watch(this.server.configLocation, {
            persistent: true,
            awaitWriteFinish: false,
        });

        Watcher.on('change', () => {
            if (this.server.knownWrite !== true) {
                this.server.log.debug('Detected remote file change, updating JSON object correspondingly.');
                Fs.readJson(this.server.configLocation, (err, object) => {
                    if (err) {
                        // Try to overwrite those changes with the old config.
                        this.server.log.warn(err, 'An error was detected with the changed file, attempting to undo the changes.');
                        this.server.knownWrite = true;
                        Fs.writeJson(this.server.configLocation, this.server.json, writeErr => {
                            if (!writeErr) {
                                this.server.log.debug('Successfully undid those remote changes.');
                            } else {
                                this.server.log.fatal(writeErr, 'Unable to undo those changes, this could break the daemon badly.');
                            }
                        });
                    } else {
                        this.server.json = object;
                    }
                });
            }
            this.server.knownWrite = false;
        });
    }

    write(file, data, next) {
        Async.series([
            callback => {
                this.server.knownWrite = true;
                callback();
            },
            callback => {
                Fs.outputFile(this.server.path(file), data, callback);
            },
        ], next);
    }

    read(file, next) {
        Fs.stat(this.server.path(file), (err, stat) => {
            if (err) return next(err);
            if (!stat.isFile()) {
                return next(new Error('The file requested does not appear to be a file.'));
            }
            if (stat.size > 10000000) {
                return next(new Error('This file is too large to open.'));
            }
            Fs.readFile(this.server.path(file), 'utf8', next);
        });
    }

    readEnd(file, bytes, next) {
        if (_.isFunction(bytes)) {
            next = bytes; // eslint-disable-line
            bytes = 80000; // eslint-disable-line
        }
        Fs.stat(this.server.path(file), (err, stat) => {
            if (err) return next(err);
            if (!stat.isFile()) {
                return next(new Error('The file requested does not appear to be a file.'));
            }
            let opts = {};
            let lines = '';
            if (stat.size > bytes) {
                opts = {
                    start: (stat.size - bytes),
                    end: stat.size,
                };
            }
            const stream = Fs.createReadStream(this.server.path(file), opts);
            stream.on('data', data => {
                lines += data;
            });
            stream.on('end', () => {
                next(null, lines);
            });
        });
    }

    delete(path, next) {
        // Safety - prevent deleting the main folder.
        if (Path.resolve(this.server.path(path)) === this.server.path()) {
            return next(new Error('You cannot delete your home folder.'));
        }
        Fs.remove(this.server.path(path), next);
    }

    move(path, newpath, next) {
        Fs.move(this.server.path(path), this.server.path(newpath), next);
    }

    copy(path, newpath, opts, next) {
        if (_.isFunction(opts)) {
            next = opts; // eslint-disable-line
            opts = {}; // eslint-disable-line
        }
        Fs.copy(this.server.path(path), this.server.path(newpath), {
            clobber: opts.clobber || false,
            preserveTimestamps: opts.timestamps || false,
        }, next);
    }

    // Bulk Rename Files
    // Accepts a string or array for initial and ending
    rename(initial, ending, next) {
        if (!_.isArray(initial) && !_.isArray(ending)) {
            Fs.move(this.server.path(initial), this.server.path(ending), { clobber: false }, err => {
                if (err && !_.startsWith(err.message, 'EEXIST:')) return next(err);
                next();
            });
        } else if (!_.isArray(initial) || !_.isArray(ending)) {
            return next(new Error('Values passed to rename function must be of the same type (string, string) or (array, array).'));
        } else {
            Async.eachOfLimit(initial, 5, (value, key, callback) => {
                if (_.isUndefined(ending[key])) {
                    return callback(new Error('The number of starting values does not match the number of ending values.'));
                }
                Fs.move(this.server.path(value), this.server.path(ending[key]), { clobber: false }, err => {
                    if (err && !_.startsWith(err.message, 'EEXIST:')) return callback(err);
                    return callback();
                });
            }, next);
        }
    }

    directory(path, next) {
        const files = [];
        Async.series([
            callback => {
                Fs.stat(this.server.path(path), (err, s) => {
                    if (err) return callback(err);
                    if (!s.isDirectory()) {
                        return callback(new Error('The path requested is not a valid directory on the system.'));
                    }
                    return callback();
                });
            },
            callback => {
                Fs.readdir(this.server.path(path), (err, contents) => {
                    Async.each(contents, (item, eachCallback) => {
                        // Lets limit the callback hell
                        const Mime = new Magic(Mmm.MAGIC_MIME_TYPE);
                        Fs.stat(Path.join(this.server.path(path), item), (statErr, stat) => {
                            if (statErr) eachCallback(statErr);
                            Mime.detectFile(Path.join(this.server.path(path), item), (mimeErr, result) => {
                                files.push({
                                    'name': item,
                                    'created': stat.ctime,
                                    'modified': stat.mtime,
                                    'size': stat.size,
                                    'directory': stat.isDirectory(),
                                    'file': stat.isFile(),
                                    'symlink': stat.isSymbolicLink(),
                                    'mime': result || 'unknown',
                                });
                                eachCallback(mimeErr);
                            });
                        });
                    }, () => {
                        callback(null, _.sortBy(files, ['name']));
                    });
                });
            },
        ], (err, data) => {
            next(err, data[1]);
        });
    }
}

module.exports = FileSystem;
