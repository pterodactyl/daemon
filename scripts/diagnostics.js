'use strict';

/**
 * Pterodactyl - Daemon
 * Copyright (c) 2015 - 2018 Dane Everitt <dane@daneeveritt.com>.
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
const Inquirer = require('inquirer');
const Request = require('request');
const Process = require('child_process');
const Fs = require('fs-extra');
const _ = require('lodash');
const Path = require('path');
const Package = require('../package.json');

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
function postToPtero(text) {
    return new Promise((resolve, reject) => {
        Request.post({
            uri: 'https://ptero.co/documents',
            body: text,
        }, (error, response, body) => {
            if (error || response.statusCode !== 200) {
                reject(error);
            } else {
                resolve(`https://ptero.co/${JSON.parse(body).key.toString()}`);
            }
        });
    });
}

Inquirer.prompt([
    {
        name: 'endpoints',
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
        message: 'Do you directly want to upload the diagnostics to hastebin.com / ptero.co?',
        default: true,
    },
]).then(answers => {
    Async.auto({
        config: callback => {
            Fs.access('./config/core.json', (Fs.constants || Fs).R_OK | (Fs.constants || Fs).W_OK, err => { // eslint-disable-line
                if (err) return callback(null, { error: true });
                return callback(null, Fs.readJsonSync('./config/core.json'));
            });
        },
        docker_version: callback => {
            Process.exec('docker --version', (err, stdout) => {
                callback(err, stdout);
            });
        },
        docker_info: callback => {
            Process.exec('docker info', (err, stdout) => {
                callback(err, stdout);
            });
        },
        docker_containers: callback => {
            Process.exec('docker ps --format \'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\' -a', (err, stdout) => {
                callback(err, stdout);
            });
        },
        bunyan_logs: callback => {
            if (answers.logs) {
                const MainLog = Fs.existsSync(Path.resolve('logs/wings.log'));
                const SecondLog = Fs.existsSync(Path.resolve('logs/wings.log.0'));

                let logFile;
                if (MainLog) {
                    logFile = 'logs/wings.log';
                } else if (SecondLog) {
                    logFile = 'logs/wings.log.0';
                } else {
                    return callback(null, '[no logs found]');
                }

                Process.exec(`tail -n 200 ${logFile} | ./node_modules/bunyan/bin/bunyan -o short`, { maxBuffer: 100 * 1024 }, (err, stdout) => {
                    callback(err, stdout);
                });
            } else {
                return callback(null, '[not provided]');
            }
        },
    }, (err, results) => {
        if (err) return console.error(err); // eslint-disable-line

        const remoteHost = (answers.endpoints) ? _.get(results.config, 'remote.base', null) : '[redacted]';
        const outputFormat = `
==[ Pterodactyl Daemon: Diagnostics Report ]==
--| Software Versions
    - Daemon:  ${Package.version}
    - Node.js: ${process.version}
    - Docker:  ${results.docker_version}

--| Daemon Configuration
    - SSL Enabled: ${_.get(results.config, 'web.ssl.enabled', null)}
    - Port:        ${_.get(results.config, 'web.listen', null)}
    - Upload Size: ${_.get(results.config, 'uploads.size_limit', null)}
    - Remote Host: ${remoteHost}

--| Docker Information
${results.docker_info}

--| Docker Containers
${results.docker_containers}

--| Latest Logs
${results.bunyan_logs}
==[ END DIAGNOSTICS ]==`;

        if (answers.hastebin) {
            postToHastebin(outputFormat)
                .then(url => {
                    console.log('Your diagnostics report is available at:', url); // eslint-disable-line
                })
                .catch(error => {
                    console.error('An error occured while uploading to hastebin.com. Attempting to upload to ptero.co', error); // eslint-disable-line
                    postToPtero(outputFormat)
                        .then(url => {
                            console.log('Your diagnostics report is available at:', url); // eslint-disable-line
                        })
                        .catch(error => { // eslint-disable-line
                            console.error('An error occured while uploading to hastebin.com & ptero.co', error); // eslint-disable-line
                        });
                });
        } else {
            console.log(outputFormat); // eslint-disable-line
        }
    });
});
