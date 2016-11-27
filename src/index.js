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
const Proc = require('child_process');
const Request = require('request');
const compareVersions = require('compare-versions');

const Log = rfr('src/helpers/logger.js');
const Package = rfr('package.json');

Log.info('+ ------------------------------------ +');
Log.info(`| Running Pterodactyl Daemon v${Package.version}    |`);
Log.info('|        https://pterodactyl.io        |');
Log.info('|  Copyright 2015 - 2016 Dane Everitt  |');
Log.info('+ ------------------------------------ +');
Log.info('Loading modules, this could take a few seconds.');

const NetworkController = rfr('src/controllers/network.js');
const Initializer = rfr('src/helpers/initialize.js').Initialize;
const SFTPController = rfr('src/controllers/sftp.js');
const LiveStats = rfr('src/http/stats.js');

const Network = new NetworkController();
const Initialize = new Initializer();
const SFTP = new SFTPController(true);
const Stats = new LiveStats();

Log.info('Modules loaded, starting Pterodactyl Daemon...');
Async.auto({
    check_version: callback => {
        Request.get('https://cdn.pterodactyl.io/releases/latest.json', {
            timeout: 5000,
        }, (err, response, body) => {
            if (err) {
                Log.warn(err, 'Download action failed due to an error with the request.');
                return this.res.send(500, { 'error': 'An error occured while attempting to perform this request.' });
            }

            if (response.statusCode === 200) {
                const json = JSON.parse(body);

                if (compareVersions(Package.version, json.daemon) >= 0) {
                    Log.info('Pterodactyl Daemon is up-to-date!');
                    return callback();
                }

                Log.warn('+ ----- WARNING! ----- +');
                Log.warn(`Pterodactyl Daemon is not up-to-date! You are running version ${Package.version} and the latest version is ${json.daemon}.`);
                Log.warn(`Find out more here: https://github.com/Pterodactyl/Daemon/releases/v${json.daemon}`);
                Log.warn('+ -------------------- +');
                return callback();
            }

            Log.warn('Unable to check if this daemon is up to date!');
            return callback();
        });
    },
    check_network: callback => {
        Log.info('Checking container networking environment...');
        Network.init(callback);
    },
    setup_network: ['check_network', (r, callback) => {
        Log.info('Checking pterodactyl0 interface and setting configuration values.');
        Network.interface(callback);
    }],
    start_sftp: callback => {
        Log.info('Attempting to start SFTP service container...');
        SFTP.startService(err => {
            if (err) return callback(err);
            Log.info('SFTP container successfully booted.');
            return callback();
        });
    },
    check_tar: callback => {
        Proc.exec('tar --help', {}, callback);
        Log.debug('Tar module found on server.');
    },
    check_zip: callback => {
        Proc.exec('unzip --help', {}, callback);
        Log.debug('Unzip module found on server.');
    },
    init_servers: ['setup_network', (r, callback) => {
        Log.info('Attempting to load servers and initialize daemon...');
        Initialize.init(callback);
    }],
    init_websocket: ['init_servers', (r, callback) => {
        Log.info('Configuring websocket for daemon stats...');
        Stats.init();
        return callback();
    }],
}, err => {
    if (err) {
        // Log a fatal error and exit.
        // We need this to initialize successfully without any errors.
        Log.fatal(err);
        process.exit(1);
    }
    rfr('src/http/routes.js');
    Log.info('Initialization Successful!');
});

process.on('uncaughtException', err => {
    Log.fatal(err, 'A fatal error occured during an operation.');
});

process.on('SIGUSR2', () => {
    Log.reopenFileStreams();
});
