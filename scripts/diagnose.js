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

/* eslint no-console: 0 */

const Inquirer = require('inquirer');
const Request = require('request');
const execSync = require('child_process').execSync;
const Path = require('path');

const packageInfo = require('../package.json');
const config = require('../config/core.json');

function postToHastebin(text) {
    return new Promise((resolve, reject) => {
        Request.post({
            uri: 'https://hastebin.com/documents',
            body: text,
        }, (error, response, body) => {
            if (error || response.statusCode !== 200) {
                reject(error);
            } else {
                resolve(`https://hastebin.com/${JSON.parse(body).key.toString()}`);
            }
        });
    });
}

function exec(command) {
    return execSync(command, {
        encoding: 'utf8',
        timeout: 5000,
    });
}

Inquirer.prompt([
    {
        name: 'includeEndpoints',
        type: 'confirm',
        message: 'Do you want to include Endpoints (i.e. the FQDN/IP of your Panel)',
        default: true,
    }, {
        name: 'logs',
        type: 'confirm',
        message: 'Do you want to include the latest logs?',
        default: true,
    }, {
        name: 'hastebin',
        type: 'confirm',
        message: 'Do you directly want to upload the diagnostics to hastebin.com?',
        default: true,
    },
]).then(answers => {
    let r = '=== WINGS DIAGNOSTICS ===\n';

    // Wings Version
    if (packageInfo) {
        r += `Wings version: ${packageInfo.version}\n\n`;
    } else {
        r += 'Error: No package.json found.\n\n';
    }

    // Wings configuration
    r += '== CONFIGURATON ==\n';
    if (config) {
        r += `SSL Enabled:       ${config.web.ssl.enabled}\n`;
        r += `Port:              ${config.web.listen}\n`;
        r += `Upload size limit: ${config.uploads.size_limit}\n`;
        if (answers.includeEndpoints) {
            r += `Remote base:       ${config.remote.base}\n`;
            r += `Remote download:   ${config.remote.download}\n`;
            r += `Remote installed:  ${config.remote.installed}\n`;
        }
        r += '\n';
    } else {
        r += 'No configuration file present.\n\n';
    }

    // Dependency Versions
    r += '== DEPENDENCIES ==\n';
    r += exec('docker --version').trim();
    r += '\n';
    r += `Nodejs Version ${exec('node --version')}\n`;

    // Docker Info
    r += '== DOCKER INFO ==\n';
    r += exec('docker info');
    r += '\n';

    // Latest logs
    if (answers.logs) {
        r += '== LOG ==\n';
        const bunyanPath = Path.join(__dirname, '../node_modules/bunyan/bin/bunyan');
        const infoLogPath = Path.join(__dirname, '../logs/error.log');
        const errorLogPath = Path.join(__dirname, '../logs/info.log');
        r += exec(`${bunyanPath} -o short ${infoLogPath} ${errorLogPath}`);
    }

    if (answers.hastebin) {
        postToHastebin(r)
            .then(url => {
                console.log(url);
            })
            .catch(error => {
                console.error('An error occured while trying to upload to hastebin.com', error);
            });
    } else {
        console.log(r);
    }
});
