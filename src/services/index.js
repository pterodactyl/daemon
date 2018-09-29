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

const Async = require('async');
const _ = require('lodash');

const { FileParseError, NoEggConfigurationError } = require('./../errors/index');
const Status = require('./../helpers/status');
const FileParserHelper = require('./../helpers/fileparser');

module.exports = class Core {
    /**
     * Create a new base service instance for a server.
     *
     * @param {Object} server
     * @param {Object|null} config
     */
    constructor(server, config = null) {
        this.server = server;
        this.service = server.json.service;
        this.parser = new FileParserHelper(this.server);
        this.config = config || {};
    }

    /**
     * Initialize the configuration for a given egg on the Daemon.
     *
     * @return {Promise<any>}
     */
    init() {
        return new Promise((resolve, reject) => {
            if (this.config.length > 0) {
                return resolve();
            }

            try {
                this.config = require(`./configs/${this.service.egg}.json`);
            } catch (ex) {
                if (ex.code !== 'MODULE_NOT_FOUND') {
                    return reject(ex);
                }
            }

            resolve();
        });
    }

    /**
     * Handles server preflight (things that need to happen before server boot). By default this will
     * iterate over all of the files to be edited for a server's egg and make any necessary modifications
     * to the file.
     *
     * @return {Promise<any>}
     */
    onPreflight() {
        return new Promise((resolve, reject) => {
            if (_.isEmpty(this.config)) {
                return reject(new NoEggConfigurationError());
            }

            // Check each configuration file and set variables as needed.
            let lastFile;
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
                    case 'xml-headless':
                        this.parser.xmlHeadless(file, _.get(data, 'find', {}), callback);
                        break;
                    default:
                        return callback(new Error('Parser assigned to file is not valid.'));
                }
            }, err => {
                if (err) {
                    return reject(new FileParseError(err.message, lastFile));
                }

                return resolve();
            });

        });
    }

    /**
     * Process console data from a server. This function can perform a number of different operations,
     * but by default it will push data over the console socket, and check if the server requires
     * user interaction to continue with startup.
     *
     * @param {String} data
     */
    onConsole(data) {
        Async.parallel([
            () => {
                if (_.startsWith(data, '> ' || _.startsWith(data, '=> '))) {
                    data = data.substr(2);
                }

                this.server.emit('console', data);
            },
            () => {
                if (this.server.status === Status.ON) {
                    return;
                }

                // Started
                if (_.includes(data, _.get(this.config, 'startup.done', null))) {
                    this.server.setStatus(Status.ON);
                }

                // Stopped; Don't trigger crash
                if (this.server.status !== Status.ON && _.isArray(_.get(this.config, 'startup.userInteraction'))) {
                    Async.each(_.get(this.config, 'startup.userInteraction'), string => {
                        if (_.includes(data, string)) {
                            this.server.log.info('Server detected as requiring user interaction, stopping now.');
                            this.server.stop(err => {
                                if (err) this.server.log.warn(err);
                            });
                        }
                    });
                }
            },
        ]);
    }
};
