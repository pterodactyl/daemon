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
const Path = require('path');
const Util = require('util');
const Fs = require('fs-extra');
const Log = rfr('src/helpers/logger.js');

const Server = rfr('src/controllers/server.js');
const Servers = {};

class Initialize {
    constructor() {
        //
    }

    /**
     * Initializes all servers on the system and loads them into memory for NodeJS.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    init(next) {
        const self = this;
        this._folders = [];
        Fs.walk('./config/servers/').on('data', function (data) {
            self._folders.push(data.path);
        }).on('end', function () {
            Async.each(self._folders, function (file, callback) {
                if (Path.extname(file) === '.json') {
                    Fs.readJson(file, function (errJson, json) {
                        if (errJson) {
                            Log.warn(errJson, Util.format('Unable to parse JSON in %s due to an error, skipping...', file));
                            return;
                        }

                        // Is this JSON valid enough?
                        if (typeof json.uuid === 'undefined') {
                            Log.warn(Util.format('Detected valid JSON, but server was missing a UUID in %s, skipping...', file));
                            return;
                        }

                        // Initalize the Server
                        self.setup(json, callback);
                    });
                } else {
                    return callback();
                }
            }, function (errAsync) {
                return next(errAsync);
            });
        });
    }

    /**
     * Performs the setup action for a specific server.
     * @param  {[type]}   json [description]
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    setup(json, next) {
        Servers[json.uuid] = new Server(json, function setupCallback(err) {
            Log.info({ server: json.uuid }, 'Loaded configuration and initalized server.');
            return next(err);
        });
    }
}

exports.Initialize = Initialize;
exports.Servers = Servers;
