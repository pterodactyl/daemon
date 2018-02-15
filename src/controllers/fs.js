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
const Fs = require('fs-extra');
const Async = require('async');
const Path = require('path');
const Chokidar = require('chokidar');
const _ = require('lodash');
const Mmm = require('mmmagic');
const RandomString = require('randomstring');
const Process = require('child_process');
const Util = require('util');
const rfr = require('rfr');
const isStream = require('isstream');
const RotatingFile = require('rotating-file-stream');
const Klaw = require('klaw');

const Magic = Mmm.Magic;
const Mime = new Magic(Mmm.MAGIC_MIME_TYPE | Mmm.MAGIC_SYMLINK);

const ConfigHelper = rfr('src/helpers/config.js');
const Config = new ConfigHelper();

class FileSystem {
    constructor(server) {
        this.server = server;
        this.logStream = null;
        this.logStreamClosing = false;

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
                        Fs.writeJson(this.server.configLocation, this.server.json, { spaces: 2 }, writeErr => {
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

    size(next) {
        const Exec = Process.spawn('du', ['-hsb', this.server.path()], {});

        Exec.stdout.on('data', data => {
            next(null, parseInt(_.split(data.toString(), '\t')[0], 10));
        });

        Exec.on('error', execErr => {
            this.server.log.error(execErr);
            return next(new Error('There was an error while attempting to check the size of the server data folder.'));
        });

        Exec.on('exit', (code, signal) => {
            if (code !== 0) {
                return next(new Error(`Unable to determine size of server data folder, exited with code ${code} signal ${signal}.`));
            }
        });
    }

    chown(file, next) {
        let chownTarget = file;
        if (!_.startsWith(chownTarget, this.server.path())) {
            chownTarget = this.server.path(file);
        }

        const Exec = Process.spawn('chown', ['-R', Util.format('%s:%s', Config.get('docker.container.username', 'pterodactyl'), Config.get('docker.container.username', 'pterodactyl')), chownTarget], {});
        Exec.on('error', execErr => {
            this.server.log.error(execErr);
            return next(new Error('There was an error while attempting to set ownership of files.'));
        });
        Exec.on('exit', (code, signal) => {
            if (code !== 0) {
                return next(new Error(`Unable to set ownership of files properly, exited with code ${code} signal ${signal}.`));
            }
            return next();
        });
    }

    isSelf(moveTo, moveFrom) {
        const target = this.server.path(moveTo);
        const source = this.server.path(moveFrom);

        if (!_.startsWith(target, source)) {
            return false;
        }

        const end = target.slice(source.length);
        if (!end) {
            return true;
        }

        return _.startsWith(end, '/');
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
            callback => {
                this.chown(file, callback);
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

    readBytes(file, offset, length, next) {
        Fs.stat(this.server.path(file), (err, stat) => {
            if (err) return next(err);
            if (!stat.isFile()) {
                const internalError = new Error('Trying to read bytes from a non-file.');
                internalError.code = 'EISDIR';

                return next(internalError);
            }

            if (offset >= stat.size) {
                return next(null, null, true);
            }

            const chunks = [];
            const stream = Fs.createReadStream(this.server.path(file), {
                start: offset,
                end: (offset + length) - 1,
            });
            stream.on('data', data => {
                chunks.push(data);
            });
            stream.on('end', () => {
                next(null, Buffer.concat(chunks), false);
            });
        });
    }

    getLogStreamPath(withFileName) {
        const configPath = Config.get('filesystem.server_logs', '/tmp/pterodactyl');

        if (withFileName === false) {
            return configPath;
        }

        return `${configPath}/${this.server.json.uuid}.log`;
    }

    getLogStreamClosing() {
        return this.logStreamClosing;
    }

    setLogStreamClosing(value) {
        this.logStreamClosing = value;
    }

    removeOldLogFiles(next) {
        const filesToDelete = [];
        Klaw(this.getLogStreamPath(false))
            .on('data', item => {
                if (item.stats.isFile() && _.startsWith(Path.basename(item.path), `${this.server.json.uuid}`)) {
                    filesToDelete.push(`${this.getLogStreamPath(false)}/${Path.basename(item.path)}`);
                }
            }).on('end', () => {
                Async.each(filesToDelete, (file, callback) => {
                    Fs.truncate(file, 0, callback);
                }, next);
            });
    }

    getLogStream(createMissing) {
        if (createMissing !== false && !isStream.isWritable(this.logStream)) {
            this.logStream = RotatingFile(index => {
                let BaseLogName = `${this.server.json.uuid}.log`;
                if (index > 0) {
                    BaseLogName += `.${index - 1}`;
                }

                return BaseLogName;
            }, {
                initialRotation: true,
                path: this.getLogStreamPath(false),
                size: '100K',
                rotate: 1,
                mode: 0o600,
            }).on('finish', () => {
                this.logStream = null;
                this.setLogStreamClosing(false);
            }).on('error', err => {
                this.server.log.error(err);
                this.logStream = null;
                this.setLogStreamClosing(false);
            });
        }

        return this.logStream;
    }

    readEndOfLogStream(bytes, next) {
        // Don't try to read the end of a log stream if there is
        // no active stream currently.
        if (this.getLogStreamClosing() || !isStream.isWritable(this.getLogStream(false))) {
            return next(null, '');
        }

        const paths = [this.getLogStreamPath(), `${this.getLogStreamPath()}.0`];
        Async.map(paths, (path, callback) => { // eslint-disable-line
            Fs.stat(path, (err, stat) => {
                if (err && err.code !== 'ENOENT') {
                    return callback(err);
                } else if (err || !stat.isFile()) {
                    return callback(null, '');
                }

                let opts = {};
                let lines = '';
                if (stat.size > bytes) {
                    opts = {
                        start: (stat.size - bytes),
                        end: stat.size,
                    };
                }

                const ReadStream = Fs.createReadStream(path, opts);

                ReadStream.on('data', data => {
                    lines += data;
                });

                ReadStream.on('end', () => {
                    callback(null, lines);
                });
            });
        }, (err, data) => {
            if (err) return this.server.log.error(err);

            const FinalOutput = _.get(data, 1, '') + _.get(data, 0, '');
            const TotalLength = Buffer.byteLength(FinalOutput, 'utf8');
            const StartPoint = (TotalLength > bytes) ? TotalLength - bytes : 0;

            return next(null, Buffer.from(FinalOutput).toString('utf8', StartPoint, TotalLength));
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

    mkdir(path, next) {
        if (!_.isArray(path)) {
            Fs.ensureDir(this.server.path(path), err => {
                if (err) return next(err);
                this.chown(path, next);
            });
        } else {
            Async.eachOfLimit(path, 5, (value, key, callback) => {
                Fs.ensureDir(this.server.path(value), err => {
                    if (err) return callback(err);
                    this.chown(value, callback);
                });
            }, next);
        }
    }

    rm(path, next) {
        if (_.isString(path)) {
            // Safety - prevent deleting the main folder.
            if (Path.resolve(this.server.path(path)) === this.server.path()) {
                return next(new Error('You cannot delete your home folder.'));
            }

            Fs.remove(this.server.path(path), next);
        } else {
            Async.eachOfLimit(path, 5, (value, key, callback) => {
                // Safety - prevent deleting the main folder.
                if (Path.resolve(this.server.path(value)) === this.server.path()) {
                    return next(new Error('You cannot delete your home folder.'));
                }

                Fs.remove(this.server.path(value), callback);
            }, next);
        }
    }

    copy(initial, ending, opts, next) {
        if (_.isFunction(opts)) {
            next = opts; // eslint-disable-line
            opts = {}; // eslint-disable-line
        }

        if (!_.isArray(initial) && !_.isArray(ending)) {
            if (this.isSelf(ending, initial)) {
                return next(new Error('You cannot copy a folder into itself.'));
            }
            Async.series([
                callback => {
                    Fs.copy(this.server.path(initial), this.server.path(ending), {
                        overwrite: opts.overwrite || true,
                        preserveTimestamps: opts.timestamps || false,
                    }, callback);
                },
                callback => {
                    this.chown(ending, callback);
                },
            ], next);
        } else if (!_.isArray(initial) || !_.isArray(ending)) {
            return next(new Error('Values passed to copy function must be of the same type (string, string) or (array, array).'));
        } else {
            Async.eachOfLimit(initial, 5, (value, key, callback) => {
                if (_.isUndefined(ending[key])) {
                    return callback(new Error('The number of starting values does not match the number of ending values.'));
                }

                if (this.isSelf(ending[key], value)) {
                    return next(new Error('You cannot copy a folder into itself.'));
                }
                Fs.copy(this.server.path(value), this.server.path(ending[key]), {
                    overwrite: _.get(opts, 'overwrite', true),
                    preserveTimestamps: _.get(opts, 'timestamps', false),
                }, err => {
                    if (err) return callback(err);
                    this.chown(ending[key], callback);
                });
            }, next);
        }
    }

    stat(file, next) {
        Fs.lstat(this.server.path(file), (err, stat) => {
            if (err) return next(err);
            Mime.detectFile(this.server.path(file), (mimeErr, result) => {
                next(null, {
                    'name': (Path.parse(this.server.path(file))).base,
                    'created': stat.birthtime,
                    'modified': stat.mtime,
                    'mode': stat.mode,
                    'size': stat.size,
                    'directory': stat.isDirectory(),
                    'file': stat.isFile(),
                    'symlink': stat.isSymbolicLink(),
                    'mime': result || 'application/octet-stream',
                });
            });
        });
    }

    move(initial, ending, next) {
        if (!_.isArray(initial) && !_.isArray(ending)) {
            if (this.isSelf(ending, initial)) {
                return next(new Error('You cannot move a file or folder into itself.'));
            }
            Fs.move(this.server.path(initial), this.server.path(ending), { overwrite: false }, err => {
                if (err && !_.startsWith(err.message, 'EEXIST:')) return next(err);
                this.chown(ending, next);
            });
        } else if (!_.isArray(initial) || !_.isArray(ending)) {
            return next(new Error('Values passed to move function must be of the same type (string, string) or (array, array).'));
        } else {
            Async.eachOfLimit(initial, 5, (value, key, callback) => {
                if (_.isUndefined(ending[key])) {
                    return callback(new Error('The number of starting values does not match the number of ending values.'));
                }

                if (this.isSelf(ending[key], value)) {
                    return next(new Error('You cannot move a file or folder into itself.'));
                }
                Fs.move(this.server.path(value), this.server.path(ending[key]), { overwrite: false }, err => {
                    if (err && !_.startsWith(err.message, 'EEXIST:')) return callback(err);
                    this.chown(ending[key], callback);
                });
            }, next);
        }
    }

    decompress(files, next) {
        if (!_.isArray(files)) {
            const fromFile = this.server.path(files);
            const toDir = fromFile.substring(0, _.lastIndexOf(fromFile, '/'));
            this.systemDecompress(fromFile, toDir, next);
        } else if (_.isArray(files)) {
            Async.eachLimit(files, 1, (file, callback) => {
                const fromFile = this.server.path(file);
                const toDir = fromFile.substring(0, _.lastIndexOf(fromFile, '/'));
                this.systemDecompress(fromFile, toDir, callback);
            }, next);
        } else {
            return next(new Error('Invalid datatype passed to decompression function.'));
        }
    }

    systemDecompress(file, to, next) {
        Mime.detectFile(file, (err, result) => {
            if (err) return next(err);

            let Exec;
            if (result === 'application/x-gzip' || result === 'application/gzip') {
                Exec = Process.spawn('tar', ['xzf', Path.basename(file), '-C', to], {
                    cwd: Path.dirname(file),
                    uid: Config.get('docker.container.user', 1000),
                    gid: Config.get('docker.container.user', 1000),
                });
            } else if (result === 'application/zip') {
                Exec = Process.spawn('unzip', ['-q', '-o', Path.basename(file), '-d', to], {
                    cwd: Path.dirname(file),
                    uid: Config.get('docker.container.user', 1000),
                    gid: Config.get('docker.container.user', 1000),
                });
            } else {
                return next(new Error(`Decompression of file failed: ${result} is not a decompessible Mimetype.`));
            }

            Exec.on('error', execErr => {
                this.server.log.error(execErr);
                return next(new Error('There was an error while attempting to decompress this file.'));
            });
            Exec.on('exit', (code, signal) => {
                if (code !== 0) {
                    return next(new Error(`Decompression of file exited with code ${code} signal ${signal}.`));
                }

                return next();
            });
        });
    }

    // Unlike other functions, if multiple files and folders are passed
    // they will all be combined into a single archive.
    compress(files, to, next) {
        if (!_.isString(to)) {
            return next(new Error('The to field must be a string for the folder in which the file should be saved.'));
        }

        const SaveAsName = `ptdlfm.${RandomString.generate(8)}.tar`;
        if (!_.isArray(files)) {
            if (this.isSelf(to, files)) {
                return next(new Error('Unable to compress folder into itself.'));
            }
            this.systemCompress([_.replace(this.server.path(files), `${this.server.path()}/`, '')], Path.join(this.server.path(to), SaveAsName), next);
        } else if (_.isArray(files)) {
            const FileEntries = [];
            Async.series([
                callback => {
                    Async.eachLimit(files, 5, (file, eachCallback) => {
                        // If it is going to be inside itself, skip and move on.
                        if (this.isSelf(to, file)) {
                            return eachCallback();
                        }

                        FileEntries.push(_.replace(this.server.path(file), `${this.server.path()}/`, ''));
                        eachCallback();
                    }, callback);
                },
                callback => {
                    if (_.isEmpty(FileEntries)) {
                        return next(new Error('None of the files passed to the command were valid.'));
                    }
                    this.systemCompress(FileEntries, Path.join(this.server.path(to), SaveAsName), callback);
                },
            ], err => {
                next(err, SaveAsName);
            });
        } else {
            return next(new Error('Invalid datatype passed to decompression function.'));
        }
    }

    systemCompress(files, archive, next) {
        const args = ['czf', archive];
        _.forEach(files, file => {
            args.push(file);
        });

        const Exec = Process.spawn('tar', args, {
            cwd: this.server.path(),
            uid: Config.get('docker.container.user', 1000),
            gid: Config.get('docker.container.user', 1000),
        });

        Exec.on('error', execErr => {
            this.server.log.error(execErr);
            return next(new Error('There was an error while attempting to compress this folder.'));
        });
        Exec.on('exit', (code, signal) => {
            if (code !== 0) {
                return next(new Error(`Compression of files exited with code ${code} signal ${signal}.`));
            }

            return next(null, Path.basename(archive));
        });
    }

    directory(path, next) {
        const responseFiles = [];
        Async.waterfall([
            callback => {
                Fs.stat(this.server.path(path), (err, s) => {
                    if (err) return callback(err);
                    if (!s.isDirectory()) {
                        const error = new Error('The path requests is not a valid directory on the system.');
                        error.code = 'ENOENT';
                        return callback(error);
                    }
                    return callback();
                });
            },
            callback => {
                Fs.readdir(this.server.path(path), callback);
            },
            (files, callback) => {
                Async.each(files, (item, eachCallback) => {
                    Async.auto({
                        do_stat: aCallback => {
                            Fs.stat(Path.join(this.server.path(path), item), (statErr, stat) => {
                                // Handle bad symlinks
                                if (statErr && statErr.code === 'ENOENT') {
                                    return eachCallback();
                                }
                                aCallback(statErr, stat);
                            });
                        },
                        do_mime: aCallback => {
                            Mime.detectFile(Path.join(this.server.path(path), item), (mimeErr, result) => {
                                aCallback(null, result);
                            });
                        },
                        do_push: ['do_stat', 'do_mime', (results, aCallback) => {
                            responseFiles.push({
                                'name': item,
                                'created': results.do_stat.birthtime,
                                'modified': results.do_stat.mtime,
                                'mode': results.do_stat.mode,
                                'size': results.do_stat.size,
                                'directory': results.do_stat.isDirectory(),
                                'file': results.do_stat.isFile(),
                                'symlink': results.do_stat.isSymbolicLink(),
                                'mime': results.do_mime || 'application/octet-stream',
                            });
                            aCallback();
                        }],
                    }, eachCallback);
                }, callback);
            },
        ], err => {
            next(err, _.sortBy(responseFiles, [(o) => { return _.lowerCase(o.name); }, 'created'])); // eslint-disable-line
        });
    }
}

module.exports = FileSystem;
