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

const Fs = require('fs-extra');
const rfr = require('rfr');
const Async = require('async');
const _ = require('lodash');
const Ssh2 = require('ssh2');
const Moment = require('moment');
const Util = require('util');
const Ssh2Streams = require('ssh2-streams');

const SftpStream = Ssh2Streams.SFTPStream;
const OPEN_MODE = Ssh2.SFTP_OPEN_MODE;
const STATUS_CODE = Ssh2.SFTP_STATUS_CODE;
const ReqHandles = [];

const Log = rfr('src/helpers/logger.js');
const Servers = rfr('src/helpers/initialize.js').Servers;

class InternalSftpServer {
    init(next) {
        Ssh2.Server({
            hostKeys: [
                Fs.readFileSync('/srv/daemon/config/credentials/ssh/ssh_host_rsa_key').toString('utf8'),
            ],
            // debug: s => {
            //     Log.debug(s);
            // },
        }, client => {
            let clientContext = false;

            client.on('authentication', ctx => {
                clientContext = {
                    client: ctx,
                    server: _.get(Servers, '58d8055e-9de3-4031-a9fa-933a1c4252e4'),
                };
                ctx.accept();
            }).on('ready', () => {
                client.on('session', accept => {
                    accept().on('sftp', a => {
                        const sftp = a();

                        sftp.on('REALPATH', reqId => {
                            sftp.name(reqId, {
                                filename: '/',
                                longname: 'drw------- 1 test test 3 Dec 8 2009 /',
                                attrs: {},
                            });
                        });

                        sftp.on('READDIR', (reqId, handle) => {
                            const requestData = _.get(ReqHandles, handle, null);
                            if (_.isNull(requestData)) {
                                Log.error('Unknown handle provided for READDIR');
                                return sftp.status(reqId, STATUS_CODE.FAILURE);
                            }

                            if (requestData.done) {
                                return sftp.status(reqId, STATUS_CODE.EOF);
                            }

                            this.handleReadDir(clientContext, requestData.path, (err, attrs) => {
                                if (err) {
                                    Log.error(err);
                                    sftp.status(reqId, STATUS_CODE.FAILURE);
                                }

                                requestData.done = true;
                                return sftp.name(reqId, attrs);
                            });
                        });

                        sftp.on('OPENDIR', (reqId, location) => {
                            const handle = this.makeHandle(reqId);
                            ReqHandles[handle] = {
                                path: location,
                                done: false,
                            };

                            sftp.handle(reqId, handle);
                        });

                        sftp.on('OPEN', (reqId, location, flags) => {
                            const handle = this.makeHandle(reqId);
                            let openType = '';

                            switch (SftpStream.flagsToString(flags)) {
                            case 'r':
                                openType = OPEN_MODE.READ;
                                break;
                            case 'w':
                                openType = OPEN_MODE.WRITE;
                                break;
                            default:
                                Log.error('Received unknown SFTP flag.', { flag: flags, request: reqId });
                                return sftp.status(reqId, STATUS_CODE.OP_UNSUPPORTED);
                            }

                            ReqHandles[handle] = {
                                type: openType,
                                path: location,
                                done: false,
                            };

                            sftp.handle(reqId, handle);
                        });

                        sftp.on('READ', (reqId, handle, offset, length) => {
                            const requestData = _.get(ReqHandles, handle, null);
                            if (_.isNull(requestData)) {
                                Log.error('Unknown handle provided for READ');
                                return sftp.status(reqId, STATUS_CODE.FAILURE);
                            }

                            if (requestData.done) {
                                return sftp.status(reqId, STATUS_CODE.EOF);
                            }

                            clientContext.server.fs.readBytes(requestData.path, offset, length, (err, data, done) => {
                                requestData.done = done || false;

                                if ((err && err.code === 'IS_DIR') || done) {
                                    return sftp.status(reqId, STATUS_CODE.EOF);
                                } else if (err) {
                                    Log.error(err);
                                    return sftp.status(reqId, STATUS_CODE.FAILURE);
                                }

                                return sftp.data(reqId, data);
                            });
                        });
                    });
                });
            }).on('error', err => {
                Log.error(err);
            });
        }).listen(2022, '0.0.0.0', next);
    }

    makeHandle(reqId) {
        return Buffer.alloc(1, reqId);
    }

    handleReadDir(ctx, path, next) {
        const server = ctx.server;

        Async.waterfall([
            callback => {
                server.fs.directory(path, callback);
            },
            (files, callback) => {
                const attrs = [];
                _.forEach(files, item => {
                    const longFormat = Util.format(
                        '%s %i %i %i %d %s %s',
                        (item.directory) ? '-rwxr-xr-x' : '-rw-r--r--',
                        (item.directory) ? 2 : 1,
                        server.json.build.user,
                        server.json.build.user,
                        item.size,
                        Moment(item.created).format('MMM D YYYY'),
                        item.name,
                    );

                    attrs.push({
                        filename: item.name,
                        longname: longFormat,
                        attrs: {
                            mode: (item.directory) ? Fs.constants.S_IFDIR | 0o755 : Fs.constants.S_IFREG | 0o644,
                            permissions: (item.directory) ? 0o755 : 0o644,
                            uid: server.json.build.user,
                            gid: server.json.build.user,
                            size: item.size,
                            atime: parseInt(Moment(item.created).format('X'), 10),
                            mtime: parseInt(Moment(item.modified).format('X'), 10),
                        },
                    });
                });

                return callback(null, attrs);
            },
        ], next);
    }
}

module.exports = InternalSftpServer;
