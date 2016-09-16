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
const extendify = require('extendify');
const Gamedig = require('gamedig');
const isStream = require('isstream');
const Path = require('path');
const createOutputStream = require('create-output-stream');

const Status = rfr('src/helpers/status.js');
const FileParserHelper = rfr('src/helpers/fileparser.js');

class Core {
    constructor(server, config) {
        this.server = server;
        this.json = server.json;
        this.option = this.json.service.option;
        this.object = undefined;
        this.logStream = undefined;

        this.parser = new FileParserHelper(this.server);

        // Find our data on initialization.
        _.forEach(config, element => {
            if (this.option.match(element.tag)) {
                // Handle "symlink" in the configuration for plugins...
                this.object = element;
                const deepExtend = extendify({
                    inPlace: false,
                    arrays: 'replace',
                });
                if (!_.isUndefined(element.symlink) && !_.isUndefined(config[element.symlink])) {
                    this.object = deepExtend(config[element.symlink], element);
                }
            }
        });
    }

    doQuery(next) {
        Gamedig.query({
            type: this.object.query,
            host: this.json.build.default.ip,
            port: this.json.build.default.port,
        }, response => {
            if (response.error) return next(new Error(`Server unresponsive to query attempt. (${response.error})`));
            return next(null, response);
        });
    }

    // Forgive me padrè for I have sinned. Badly.
    //
    // This is some incredibly messy code. As best I can describe, it
    // loop through each listed config file, and then uses regex to search
    // and replace values with values from the config file.
    //
    // This is all done with parallel functions, so every listed file
    // is opened, and then all of the lines are run at the same time.
    // Very quick function, surprisingly...
    onPreflight(next) {
        // Check each configuration file and set variables as needed.
        Async.forEachOf(this.object.configs, (data, file, callback) => {
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
            default:
                return callback(new Error('Parser assigned to file is not valid.'));
            }
        }, err => {
            if (err) return next(err);
            if (_.get(this.object, 'log.custom', false) === true) {
                if (isStream.isWritable(this.logStream)) {
                    this.logStream.end(() => {
                        this.logStream = false;
                    });
                }
                Fs.remove(this.server.path(_.get(this.object, 'log.location', 'logs/latest.log')), removeErr => {
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

    onStart(next) {
        return next();
    }

    onConsole(data) {
        Async.parallel([
            () => {
                // Custom Log?
                if (_.get(this.object, 'log.custom', false) === true) {
                    if (isStream.isWritable(this.logStream)) {
                        this.logStream.write(`${data}\n`);
                    } else {
                        const LogFile = this.server.path(_.get(this.object, 'log.location', 'logs/latest.log'));
                        Async.series([
                            callback => {
                                this.logStream = createOutputStream(LogFile, {
                                    mode: '0755',
                                    defaultEncoding: 'utf8',
                                });
                                return callback();
                            },
                            callback => {
                                Fs.chown(Path.dirname(LogFile), this.json.build.user, this.json.build.user, callback);
                            },
                        ], err => {
                            if (err) this.server.log.warn(err);
                        });
                    }
                }
            },
            () => {
                // Started
                if (_.includes(data, this.object.startup.done)) {
                    this.server.setStatus(Status.ON);
                }

                // Stopped; Don't trigger crash
                if (this.server.status !== Status.ON && !_.isUndefined(this.object.startup.userInteraction)) {
                    Async.each(this.object.startup.userInteraction, string => {
                        if (_.includes(data, string)) {
                            this.server.log.info('Server detected as requiring user interaction, stopping now.');
                            this.server.setStatus(Status.STOPPING);
                        }
                    });
                }
            },
            () => {
                this.server.emit('console', data);
            },
        ]);
    }

    onStop(next) {
        if (isStream.isWritable(this.logStream)) {
            this.logStream.end(() => {
                this.logStream = false;
            });
        }
        return next();
    }

}

module.exports = Core;
