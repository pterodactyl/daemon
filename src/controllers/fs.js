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

class FileSystem {
    constructor(server) {
        this.server = server;

        const self = this;
        const Watcher = Chokidar.watch(this.server.configLocation, {
            persistent: true,
            awaitWriteFinish: true,
        });

        Watcher.on('change', function () {
            if (self.server.knownWrite !== true) {
                Fs.readJson(self.server.configLocation, function (err, object) {
                    if (err) {
                        // Try to overwrite those changes with the old config.
                        self.server.log.warn(err, 'An error was detected with the changed file, attempting to undo the changes.');
                        self.server.knownWrite = true;
                        Fs.writeJson(self.server.configLocation, self.server.json, function (writeErr) {
                            if (!writeErr) {
                                self.server.log.debug('Successfully undid those remote changes.');
                            } else {
                                self.server.log.fatal(writeErr, 'Unable to undo those changes, this could break the daemon badly.');
                            }
                        });
                    } else {
                        self.server.log.debug('Detected file change, updating JSON object correspondingly.');
                        self.server.json = object;
                    }
                });
            }
            self.server.knownWrite = false;
        });
    }

    write(file, data, next) {
        Fs.outputFile(this.server.path(file), data, function (err) {
            return next(err);
        });
    }

    read(file, next) {
        const self = this;
        Fs.stat(this.server.path(file), function (err, stat) {
            if (err) return next(err);
            if (!stat.isFile()) {
                return next(new Error('The file requested does not appear to be a file.'));
            }
            if (stat.size > 10000000) {
                return next(new Error('This file is too large to open.'));
            }
            Fs.readFile(self.server.path(file), 'utf8', function (readErr, data) {
                return next(readErr, data);
            });
        });
    }

    readEnd(file, bytes, next) {
        const self = this;
        if (typeof bytes === 'function') {
            next = bytes; // eslint-disable-line
            bytes = 80000; // eslint-disable-line
        }
        Fs.stat(this.server.path(file), function (err, stat) {
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
            const stream = Fs.createReadStream(self.server.path(file), opts);
            stream.on('data', function (data) {
                lines = lines + data;
            });
            stream.on('end', function () {
                return next(null, lines);
            });
        });
    }

    delete(path, next) {
        // Safety - prevent deleting the main folder.
        if (Path.resolve(this.server.path(path)) === this.server.path()) {
            return next(new Error('You cannot delete your home folder.'));
        }
        Fs.remove(this.server.path(path), function (err) {
            return next(err);
        });
    }

    move(path, newpath, next) {
        Fs.move(this.server.path(path), this.server.path(newpath), function (err) {
            return next(err);
        });
    }

    copy(path, newpath, opts, next) {
        if (typeof opts === 'function') {
            next = opts; // eslint-disable-line
            opts = {}; // eslint-disable-line
        }
        Fs.copy(this.server.path(path), this.server.path(newpath), {
            clobber: opts.clobber || false,
            preserveTimestamps: opts.timestamps || false,
        }, function (err) {
            return next(err);
        });
    }

    directory(path, next) {
        const files = [];
        const self = this;
        Async.series([
            function asyncDirectoryExists(callback) {
                Fs.stat(self.server.path(path), function (err, s) {
                    if (err) return callback(err);
                    if (!s.isDirectory()) {
                        return callback(new Error('The path requested is not a valid directory on the system.'));
                    }
                    return callback();
                });
            },
            function asyncDirectoryRead(callback) {
                Fs.readdir(self.server.path(path), function (err, contents) {
                    Async.each(contents, function asyncDirectoryReadAsyncEach(item, eachCallback) {
                        // Lets limit the callback hell
                        const stat = Fs.statSync(Path.join(self.server.path(path), item));
                        files.push({
                            'name': item,
                            'created': stat.ctime,
                            'modified': stat.mtime,
                            'size': stat.size,
                            'directory': stat.isDirectory(),
                            'file': stat.isFile(),
                            'symlink': stat.isSymbolicLink(),
                        });
                        eachCallback();
                    }, function () {
                        return callback(null, files);
                    });
                });
            },
        ], function (err, data) {
            return next(err, data[1]);
        });
    }
}

module.exports = FileSystem;
