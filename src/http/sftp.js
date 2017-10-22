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

const ConfigHelper = rfr('src/helpers/config.js');
const Log = rfr('src/helpers/logger.js');
const Servers = rfr('src/helpers/initialize.js').Servers;

const Config = new ConfigHelper();

class InternalSftpServer {
    init(next) {
        Ssh2.Server({
            hostKeys: [
                Fs.readFileSync('/srv/daemon/config/credentials/ssh/ssh_host_rsa_key').toString('utf8'),
            ],
        }, client => {
            let clientContext = {};
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
                                longname: 'drw------- 0 1001 1001 3 Dec 8 2009 /',
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
                            const data = {
                                path: location,
                                done: false,
                            };

                            switch (SftpStream.flagsToString(flags)) {
                            case 'r':
                                data.type = OPEN_MODE.READ;
                                break;
                            case 'w':
                                data.type = OPEN_MODE.WRITE;
                                data.writer = this.createWriter(clientContext, location);
                                break;
                            default:
                                Log.error('Received unknown SFTP flag.', { flag: SftpStream.flagsToString(flags), request: reqId });
                                return sftp.status(reqId, STATUS_CODE.OP_UNSUPPORTED);
                            }

                            ReqHandles[handle] = data;
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

                        sftp.on('SETSTAT', (reqId, path, attrs) => {
                            sftp.status(reqId, STATUS_CODE.OK);
                        });

                        sftp.on('WRITE', (reqId, handle, offset, data) => {
                            const requestData = _.get(ReqHandles, handle, null);
                            if (_.isNull(requestData)) {
                                Log.error('Unknown handle provided for READ');
                                return sftp.status(reqId, STATUS_CODE.FAILURE);
                            }

                            // The writer is closed in the sftp.on('CLOSE') listener.
                            Fs.write(requestData.writer, data, 0, data.length, null, err => {
                                if (err) {
                                    Log.error(err);
                                    return sftp.status(reqId, STATUS_CODE.FAILURE);
                                }

                                return sftp.status(reqId, STATUS_CODE.OK);
                            });
                        });

                        sftp.on('MKDIR', (reqId, path) => {
                            Fs.ensureDir(clientContext.server.path(path), err => {
                                if (err) Log.error(err);

                                return sftp.status(reqId, err ? STATUS_CODE.FAILURE : STATUS_CODE.OK);
                            });
                        });

                        sftp.on('RENAME', (reqId, oldPath, newPath) => {
                            clientContext.server.fs.move(oldPath, newPath, err => {
                                if (err) Log.error(err);

                                return sftp.status(reqId, err ? STATUS_CODE.FAILURE : STATUS_CODE.OK);
                            });
                        });

                        // Remove and RmDir function the exact same in terms of how the Daemon processes
                        // the request. Simplify logic and just pass the remove event over to the rmdir handler.
                        sftp.on('REMOVE', (reqId, path) => {
                            sftp.emit('RMDIR', reqId, path);
                        });

                        sftp.on('RMDIR', (reqId, path) => {
                            clientContext.server.fs.rm(path, err => {
                                if (err) Log.error(err);

                                return sftp.status(reqId, err ? STATUS_CODE.FAILURE : STATUS_CODE.OK);
                            });
                        });

                        // Unsupported operations.
                        sftp.on('SYMLINK', reqId => {
                            sftp.status(reqId, STATUS_CODE.OP_UNSUPPORTED);
                        });

                        sftp.on('READLINK', reqId => {
                            sftp.status(reqId, STATUS_CODE.OP_UNSUPPORTED);
                        });

                        // Cleanup things.
                        sftp.on('CLOSE', (reqId, handle) => {
                            const requestData = _.get(ReqHandles, handle, null);
                            if (!_.isNull(requestData)) {
                                // If the writer is still active, close it and chown the item
                                // that was written.
                                if (!_.isUndefined(_.get(requestData, 'writer'))) {
                                    Fs.close(requestData.writer);
                                    clientContext.server.fs.chown(requestData.path, err => {
                                        if (err) Log.error(err);
                                    });
                                }

                                delete ReqHandles[handle];
                            }

                            return sftp.status(reqId, STATUS_CODE.OK);
                        });
                    });
                });
            }).on('error', err => {
                Log.error(err);
            });
        }).listen(Config.get('sftp.port', 2022), Config.get('sftp.ip', '0.0.0.0'), next);
    }

    makeHandle(reqId) {
        return Buffer.alloc(1, reqId);
    }

    createWriter(ctx, path) {
        return Fs.openSync(ctx.server.path(path), 'w', 0o644);
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
                        '%s 0 %i %i %d %s %s',
                        (item.directory) ? 'drwxr-xr-x' : '-rw-r--r--',
                        Config.get('docker.container.user', 1000),
                        Config.get('docker.container.user', 1000),
                        item.size,
                        Moment(item.created).format('MMM DD HH:mm'),
                        item.name,
                    );

                    attrs.push({
                        filename: item.name,
                        longname: longFormat,
                        attrs: {
                            mode: (item.directory) ? Fs.constants.S_IFDIR | 0o755 : Fs.constants.S_IFREG | 0o644,
                            permissions: (item.directory) ? 0o755 : 0o644,
                            uid: Config.get('docker.container.user', 1000),
                            gid: Config.get('docker.container.user', 1000),
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
