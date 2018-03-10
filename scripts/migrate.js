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

const _ = require('lodash');
const rfr = require('rfr');
const Async = require('async');
const Inquirer = require('inquirer');
const Klaw = require('klaw');
const Fs = require('fs-extra');
const Path = require('path');
const Process = require('child_process');
const Util = require('util');

const ConfigHelper = rfr('src/helpers/config.js');
const Config = new ConfigHelper();

Inquirer.prompt([
    {
        name: 'perform',
        type: 'confirm',
        message: 'Are you sure you wish to migrate server data locations?',
        default: false,
    },
    {
        name: 'stopped',
        type: 'confirm',
        message: 'Have you stopped *ALL* running server instances and the Daemon?',
        default: false,
    },
    {
        name: 'backup',
        type: 'confirm',
        message: 'Have you backed up your server data?',
        default: false,
    },
    {
        name: 'docker',
        type: 'confirm',
        message: 'Are you aware that you will need to run `docker system purge` after completing this migration?',
        default: false,
    },
]).then(answers => {
    if (!answers.perform || !answers.stopped || !answers.backup || !answers.docker) {
        process.exit();
    }

    console.log('Beginning data migration, do not exit this script or power off the server.');
    console.log('This may take some time to run depending on the size of server folders.');

    this.folders = [];
    Async.series([
        callback => {
            Klaw('./config/servers/').on('data', data => {
                this.folders.push(data.path);
            }).on('end', callback);
        },
        callback => {
            Async.eachOfLimit(this.folders, 2, (file, k, ecall) => {
                if (Path.extname(file) === '.json') {
                    Async.auto({
                        json: acall => {
                            Fs.readJson(file, acall);
                        },
                        paths: ['json', (r, acall) => {
                            const CurrentPath = Path.join(Config.get('sftp.path', '/srv/daemon-data'), _.get(r.json, 'user', '_SHOULD_SKIP'), '/data');
                            const NewPath = Path.join(Config.get('sftp.path', '/srv/daemon-data'), r.json.uuid);

                            return acall(null, {
                                currentPath: CurrentPath,
                                newPath: NewPath,
                            });
                        }],
                        exists: ['paths', (r, acall) => {
                            Fs.access(r.paths.currentPath, Fs.constants.F_OK | Fs.constants.R_OK, err => {
                                acall(null, !err);
                            });
                        }],
                        directory: ['exists', (r, acall) => {
                            if (r.exists) {
                                Fs.ensureDir(r.paths.newPath, acall);
                            } else {
                                return acall();
                            }
                        }],
                        move: ['directory', (r, acall) => {
                            if (r.exists) {
                                console.log(`Moving files from ${r.paths.currentPath} to ${r.paths.newPath}`);
                                Process.exec(`mv ${r.paths.currentPath}/* ${r.paths.newPath}/.`, {}, acall);
                            } else {
                                console.log(`Skipping move for ${r.paths.currentPath} as folder does not exist.`);
                                return acall();
                            }
                        }],
                        cleanup: ['move', (r, acall) => {
                            if (r.exists) {
                                console.log(`Removing old data directory: ${Path.join(r.paths.currentPath, '../')}`);
                                Fs.remove(Path.join(r.paths.currentPath, '../'), acall);
                            } else {
                                return acall();
                            }
                        }],
                    }, ecall);
                } else {
                    return ecall();
                }
            }, callback);
        },
        callback => {
            console.log('Setting correct ownership of files.');
            const Exec = Process.spawn('chown', ['-R', Util.format('%d:%d', Config.get('docker.container.user', 1000), Config.get('docker.container.user', 1000)), Config.get('sftp.path', '/srv/daemon-data')]);
            Exec.on('error', callback);
            Exec.on('exit', () => { callback(); });
        },
    ], err => {
        if (err) return console.error(err);

        console.log('Completed move of all server files to new data structure.');
    });
});
