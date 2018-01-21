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
const _ = require('lodash');
const Async = require('async');
const Fs = require('fs-extra');
const Properties = require('properties-parser');
const Yaml = require('node-yaml');
const Ini = require('ini');
const rfr = require('rfr');
const jsdom = require('jsdom');

const ConfigHelper = rfr('src/helpers/config.js');

const Config = new ConfigHelper();
const { JSDOM } = jsdom;

class FileParser {
    constructor(server) {
        this.server = server;
    }

    getReplacement(replacement) {
        return replacement.replace(/{{\s?(\S+)\s?}}/g, ($0, $1) => { // eslint-disable-line
            if (_.startsWith($1, 'server')) {
                return _.reduce(_.split(_.replace($1, 'server.', ''), '.'), (o, i) => o[i], this.server.json);
            } else if (_.startsWith($1, 'env')) {
                return _.get(this.server.json, `build.env.${_.replace($1, 'env.', '')}`, '');
            } else if (_.startsWith($1, 'config')) {
                return Config.get(_.replace($1, 'config.', ''));
            }
            return $0;
        });
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
                    return callback(null, _.split(data.toString(), '\n'));
                });
            },
            (lines, callback) => {
                // @TODO: add line if its not already there.
                Async.forEachOf(lines, (line, index, eachCallback) => {
                    Async.forEachOf(strings, (replaceString, findString, eachEachCallback) => {
                        if (_.startsWith(line, findString)) {
                            lines[index] = this.getReplacement(replaceString); // eslint-disable-line
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
            Async.forEachOf(strings, (replacement, eachKey, callback) => {
                let newValue;
                const matchedElements = [];

                // Used for wildcard matching
                const Split = _.split(eachKey, '.');
                const Pos = _.indexOf(Split, '*');

                // Determine if a '*' character is present, and if so
                // push all of the matching keys into the matchedElements array
                if (Pos >= 0) {
                    const SearchBlock = (_.dropRight(Split, Split.length - Pos)).join('.');
                    _.find(data[SearchBlock], (object, key) => { // eslint-disable-line
                        Split[Pos] = key;
                        matchedElements.push(Split.join('.'));
                    });
                } else {
                    matchedElements.push(eachKey);
                }

                // Loop through the matchedElements array and handle replacements
                // as needed.
                Async.each(matchedElements, (element, eCallback) => {
                    if (_.isString(replacement)) {
                        newValue = this.getReplacement(replacement);
                    } else if (_.isObject(replacement)) {
                        // Find & Replace
                        newValue = _.get(data, element);
                        _.forEach(replacement, (rep, find) => {
                            newValue = _.replace(newValue, find, this.getReplacement(rep));
                        });
                    } else {
                        newValue = replacement;
                    }

                    if (!_.isBoolean(newValue) && !_.isNaN(_.toNumber(newValue))) {
                        newValue = _.toNumber(newValue);
                    }

                    _.set(data, element, newValue);
                    eCallback();
                }, callback);
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
                let newValue;
                if (_.isString(value)) {
                    newValue = this.getReplacement(value);
                } else { newValue = value; }

                Editor.set(key, newValue);
                callback();
            }, () => {
                Editor.save(this.server.path(file), next);
            });
        });
    }

    json(file, strings, next) {
        Fs.readJson(this.server.path(file), (err, data) => {
            if (err) {
                if (_.startsWith(err.message, 'ENOENT: no such file or directory')) return next();
                return next(err);
            }
            Async.forEachOf(strings, (replacement, eachKey, callback) => {
                let newValue;
                const matchedElements = [];

                // Used for wildcard matching
                const Split = _.split(eachKey, '.');
                const Pos = _.indexOf(Split, '*');

                // Determine if a '*' character is present, and if so
                // push all of the matching keys into the matchedElements array
                if (Pos >= 0) {
                    const SearchBlock = (_.dropRight(Split, Split.length - Pos)).join('.');
                    _.find(data[SearchBlock], (object, key) => { // eslint-disable-line
                        Split[Pos] = key;
                        matchedElements.push(Split.join('.'));
                    });
                } else {
                    matchedElements.push(eachKey);
                }

                // Loop through the matchedElements array and handle replacements
                // as needed.
                Async.each(matchedElements, (element, eCallback) => {
                    if (_.isString(replacement)) {
                        newValue = this.getReplacement(replacement);
                    } else if (_.isObject(replacement)) {
                        // Find & Replace
                        newValue = _.get(data, element);
                        _.forEach(replacement, (rep, find) => {
                            newValue = _.replace(newValue, find, this.getReplacement(rep));
                        });
                    } else {
                        newValue = replacement;
                    }

                    if (!_.isBoolean(newValue) && !_.isNaN(_.toNumber(newValue))) {
                        newValue = _.toNumber(newValue);
                    }

                    _.set(data, element, newValue);
                    eCallback();
                }, callback);
            }, () => {
                Fs.writeJson(this.server.path(file), data, { spaces: 2 }, next);
            });
        });
    }

    ini(file, strings, next) {
        Async.waterfall([
            callback => {
                Fs.readFile(this.server.path(file), 'utf8', (err, result) => {
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
                    let newValue;
                    if (_.isString(value)) {
                        newValue = this.getReplacement(value);
                    } else { newValue = value; }
                    if (!_.isBoolean(newValue) && !_.isNaN(_.toNumber(newValue))) {
                        newValue = _.toNumber(newValue);
                    }

                    _.set(data, key, Ini.safe(newValue));
                    eachCallback();
                }, () => {
                    callback(null, data);
                });
            },
            (data, callback) => {
                Fs.writeFile(this.server.path(file), Ini.encode(data), 'utf8', callback);
            },
        ], next);
    }

    xml(file, strings, next) {
        JSDOM.fromFile(this.server.path(file)).then(dom => {
            Async.waterfall([
                callback => {
                    Async.forEachOf(strings, (value, key, eachCallback) => {
                        let newValue;
                        if (_.isString(value)) {
                            newValue = this.getReplacement(value);
                        } else { newValue = value; }
                        if (!_.isBoolean(newValue) && !_.isNaN(_.toNumber(newValue))) {
                            newValue = _.toNumber(newValue);
                        }

                        if (newValue !== 'undefined') {
                            let element = dom.window.document.querySelector(key)
                            if (element) {
                                element.textContent = newValue;
                            }
                        }
                        eachCallback();
                    }, () => {
                        callback(null, dom);
                    });
                },
                (dom, callback) => {
                    Fs.writeFile(this.server.path(file), dom.serialize(), 'utf8', callback);
                },
            ], next)
        }).catch((err) => next(err))
    }
}

module.exports = FileParser;
