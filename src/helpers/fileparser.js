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
const _ = require('lodash');
const Async = require('async');
const Fs = require('fs-extra');
const Properties = require('properties-parser');
const Yaml = require('node-yaml');
const Ini = require('ini');

class FileParser {

    constructor(server) {
        this.server = server;
    }

    file(file, strings, next) {
        if (!_.isObject(strings)) {
            return next(new Error('Variable `strings` must be passed as an object.'));
        }

        Async.waterfall([
            callback => {
                Fs.readFile(this.server.path(file), (err, data) => {
                    if (err) {
                        if (_.startsWith(err.message, 'ENOENT: no such file or directory')) return next();
                        return next(err);
                    }
                    return callback(null, data.toString().split('\n'));
                });
            },
            (lines, callback) => {
                // @TODO: add line if its not already there.
                Async.forEachOf(lines, (line, index, eachCallback) => {
                    Async.forEachOf(strings, (replaceString, findString, eachEachCallback) => {
                        if (line.startsWith(findString)) {
                            lines[index] = replaceString.replace(/{{ (\S+) }}/g, ($0, $1) => { // eslint-disable-line
                                return _.reduce(($1).split('.'), (o, i) => o[i], this.server.json);
                            });
                        }
                        return eachEachCallback();
                    }, () => {
                        eachCallback();
                    });
                }, () => {
                    callback(null, lines.join('\n'));
                });
            },
            (lines, callback) => {
                Fs.writeFile(this.server.path(file), lines, callback);
            },
        ], (err, result) => {
            next(err, result);
        });
    }

    yaml(file, strings, next) {
        Yaml.read(this.server.path(file), (err, data) => {
            if (err) {
                if (_.startsWith(err.message, 'ENOENT: no such file or directory')) return next();
                return next(err);
            }
            Async.forEachOf(strings, (value, key, callback) => {
                const saveValue = value.replace(/{{ (\S+) }}/g, ($0, $1) => { // eslint-disable-line
                    return _.reduce(($1).split('.'), (o, i) => o[i], this.server.json);
                });
                _.set(data, key, saveValue);
                callback();
            }, () => {
                Yaml.write(this.server.path(file), data, writeErr => {
                    next(writeErr);
                });
            });
        });
    }

    prop(file, strings, next) {
        Properties.createEditor(this.server.path(file), (err, Editor) => {
            if (err) {
                if (_.startsWith(err.message, 'ENOENT: no such file or directory')) return next();
                return next(err);
            }
            Async.forEachOf(strings, (value, key, callback) => {
                const saveValue = value.replace(/{{ (\S+) }}/g, ($0, $1) => { // eslint-disable-line
                    return _.reduce(($1).split('.'), (o, i) => o[i], this.server.json);
                });
                Editor.set(key, saveValue);
                callback();
            }, () => {
                Editor.save(this.server.path(file), next);
            });
        });
    }

    ini(file, strings, next) {
        Async.waterfall([
            callback => {
                Fs.readFile(this.server.path(file), (err, result) => {
                    if (err) {
                        if (_.startsWith(err.message, 'ENOENT: no such file or directory')) return next();
                        return next(err);
                    }
                    callback(null, result);
                });
            },
            (contents, callback) => {
                const data = Ini.parse(contents);
                Async.forEachOf(strings, (value, key, eachCallback) => {
                    const saveValue = value.replace(/{{ (\S+) }}/g, ($0, $1) => { // eslint-disable-line
                        return _.reduce(($1).split('.'), (o, i) => o[i], this.server.json);
                    });
                    _.set(data, key, Ini.safe(saveValue));
                    eachCallback();
                }, () => {
                    callback(data);
                });
            },
            (data, callback) => {
                Fs.writeFile(this.server.path(file), Ini.encode(data), callback);
            },
        ], next);
    }

}

module.exports = FileParser;
