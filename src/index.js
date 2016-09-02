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

const Log = rfr('src/helpers/logger.js');
const Package = rfr('package.json');

Log.info('+ ------------------------------------ +');
Log.info(`| Running Pterodactyl Daemon v${Package.version}    |`);
Log.info('|        https://pterodactyl.io        |');
Log.info('|  Copyright 2015 - 2016 Dane Everitt  |');
Log.info('+ ------------------------------------ +');
Log.info('Loading modules, this could take a few seconds.');

const Initializer = rfr('src/helpers/initialize.js').Initialize;
const SFTPController = rfr('src/controllers/sftp.js');
const LiveStats = rfr('src/http/stats.js');
const ConfigHelper = rfr('src/helpers/config.js');

const Initialize = new Initializer();
const SFTP = new SFTPController(true);
const Stats = new LiveStats();
const Config = new ConfigHelper();

Async.series([
    callback => {
        Log.info('Starting Pterodactyl Daemon...');
        if (!Config.get('docker.interface')) {
            Log.info('Checking docker0 interface and setting configuration values.');
            return Config.initDockerInterface(callback);
        }
        Log.info(`Docker interface detected as ${Config.get('docker.interface')}`);
        return callback();
    },
    callback => {
        Log.info('Attempting to start SFTP service container...');
        SFTP.startService(callback);
    },
    callback => {
        Log.info('SFTP service container booted!');
        Log.info('Attempting to load servers and initialize daemon...');
        Initialize.init(callback);
    },
    callback => {
        Log.info('Configuring websocket for daemon stats...');
        Stats.init();
        return callback();
    },
], err => {
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
