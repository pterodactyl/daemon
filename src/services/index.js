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
const _ = require('lodash');
const Fs = require('fs-extra');
const isStream = require('isstream');
const Path = require('path');
const Util = require('util');
const createOutputStream = require('create-output-stream');
const Ansi = require('ansi-escape-sequences');

const Status = rfr('src/helpers/status.js');
const FileParserHelper = rfr('src/helpers/fileparser.js');

class Core {
    constructor(server, config = null, next) {
        this.server = server;
        this.json = server.json;

        try {
            this.config = config || rfr(Util.format('src/services/configs/%s.json', this.json.service.egg));
        } catch (ex) {
            if (ex.code === 'MODULE_NOT_FOUND') {
                this.server.log.warn('Could not locate an Egg configuration for server, a rebuild will be required.');
                this.config = {};
            } else {
                throw ex;
            }
        }

        this.service = this.json.service;
        this.logStream = undefined;
        this.logStreamClosing = false;

        this.parser = new FileParserHelper(this.server);

        return next();
    }

    doQuery(next) {
        return next(null);
    }

    onPreflight(next) {
        if (_.isEmpty(this.config)) {
            this.server.emit('console', `${Ansi.style['bg-red']}${Ansi.style.white}[Pterodactyl Daemon] No Egg configuration located. This server cannot be started.`);
            return next(new Error('A server cannot be started if there is no configuration loaded for the Egg.'));
        }

        let lastFile;

        // Check each configuration file and set variables as needed.
        Async.forEachOf(_.get(this.config, 'configs', {}), (data, file, callback) => {
            lastFile = file;
            switch (_.get(data, 'parser', 'file')) {
            case 'file':
                this.parser.file(file, _.get(data, 'find', {}), callback);
                break;
            case 'yaml':
                this.parser.yaml(file, _.get(data, 'find', {}), callback);
                break;
            case 'properties':
                this.parser.prop(file, _.get(data, 'find', {}), callback);
                break;
            case 'ini':
                this.parser.ini(file, _.get(data, 'find', {}), callback);
                break;
            case 'json':
                this.parser.json(file, _.get(data, 'find', {}), callback);
                break;
            case 'xml':
                this.parser.xml(file, _.get(data, 'find', {}), callback);
                break;
            default:
                return callback(new Error('Parser assigned to file is not valid.'));
            }
        }, err => {
            if (err) {
                this.server.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] ${err.name} while processing ${lastFile}`);
                this.server.emit('console', `${Ansi.style.red}[Pterodactyl Daemon] ${err.message}`);
                return next(err);
            }

            if (_.get(this.config, 'log.custom', false)) {
                if (!this.logStreamClosing && isStream.isWritable(this.logStream)) {
                    this.logStreamClosing = true;
                    this.logStream.end(() => {
                        this.logStream = false;
                        this.logStreamClosing = false;
                    });
                }
                Fs.remove(this.server.path(_.get(this.config, 'log.location', 'logs/latest.log')), removeErr => {
                    if (removeErr && !_.includes(removeErr.message, 'ENOENT: no such file or directory')) {
                        return next(removeErr);
                    }
                    return next();
                });
            } else {
                return next();
            }
        });
    }

    onAttached(next) {
        if (_.isFunction(next)) {
            return next();
        }
    }

    onStart(next) {
        if (_.isFunction(next)) {
            return next();
        }
    }

    onConsole(data) {
        Async.parallel([
            () => {
                this.server.emit('console', data);
            },
            () => {
                // Custom Log?
                if (_.get(this.config, 'log.custom', false) === true) {
                    if (!this.logStreamClosing && isStream.isWritable(this.logStream)) {
                        this.logStream.write(`${data}\n`);
                    } else if(!this.logStreamClosing) { // Don't recreate the stream when its supposed to close.
                        const LogFile = this.server.path(_.get(this.config, 'log.location', 'logs/latest.log'));
                        Async.series([
                            callback => {
                                this.logStream = createOutputStream(LogFile, {
                                    mode: '0o644',
                                    defaultEncoding: 'utf8',
                                });
                                return callback();
                            },
                            callback => {
                                Fs.chown(Path.dirname(LogFile), Config.get('docker.container.user', 1000), Config.get('docker.container.user', 1000), callback);
                            },
                        ], err => {
                            if (err) this.server.log.warn(err);
                        });
                    }
                }
            },
            () => {
                // Started
                if (_.includes(data, _.get(this.config, 'startup.done', null))) {
                    Async.series([
                        callback => {
                            this.onStart(callback);
                        },
                        callback => {
                            this.server.setStatus(Status.ON);
                            callback();
                        },
                    ]);
                }

                // Stopped; Don't trigger crash
                if (this.server.status !== Status.ON && _.isArray(_.get(this.config, 'startup.userInteraction'))) {
                    Async.each(_.get(this.config, 'startup.userInteraction'), string => {
                        if (_.includes(data, string)) {
                            this.server.log.info('Server detected as requiring user interaction, stopping now.');
                            this.server.setStatus(Status.STOPPING);
                            this.server.command(_.get(this.config, 'stop'), err => {
                                if (err) this.server.log.warn(err);
                            });
                        }
                    });
                }
            },
        ]);
    }

    onStop(next) {
        Async.series([
            callback => {
                if (!this.logStreamClosing && isStream.isWritable(this.logStream)) {
                    this.logStreamClosing = true;
                    this.logStream.end(() => {
                        this.logStream = false;
                        this.logStreamClosing = false;
                        callback();
                    });
                } else {
                    callback();
                }
            },
        ], err => {
            if (_.isFunction(next)) {
                return next(err);
            }
        });
    }
}

module.exports = Core;
