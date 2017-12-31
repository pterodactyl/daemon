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
const Path = require('path');
const Randomstring = require('randomstring');
const Request = require('request');

const SftpStream = Ssh2Streams.SFTPStream;
const OPEN_MODE = Ssh2.SFTP_OPEN_MODE;
const STATUS_CODE = Ssh2.SFTP_STATUS_CODE;

const Log = rfr('src/helpers/logger.js');
const ConfigHelper = rfr('src/helpers/config.js');
const Servers = rfr('src/helpers/initialize.js').Servers;
const Config = new ConfigHelper();

class InternalSftpServer {
    init(next) {
        Ssh2.Server({
            algorithms: { compress: Config.get('sftp.algos.compress', ['none', 'zlib']) },
            hostKeys: [
                Fs.readFileSync(Config.get('sftp.keypair.hostkey_path', './config/.sftp/id_rsa')).toString('utf8'),
            ],
        }, client => {
            let clientContext;
            client.on('authentication', ctx => {
                if (ctx.method === 'password') {
                    const endpoint = `${Config.get('remote.base')}/api/remote/sftp`;
                    Request({
                        method: 'POST',
                        url: endpoint,
                        json: {
                            username: ctx.username,
                            password: ctx.password,
                        },
                        headers: {
                            'Authorization': `Bearer ${Config.get('keys.0')}`,
                        },
                    }, (err, response, body) => {
                        if (err) {
                            Log.error(err, 'An error was encountered while attempting to authenticate SFTP credentials.');
                            return ctx.reject(['password']);
                        }

                        if (response.statusCode !== 200) {
                            Log.warn({
                                responseCode: response.statusCode,
                                requestUrl: endpoint,
                                username: ctx.username,
                                response: _.get(body, 'errors'),
                            }, 'Panel reported an invalid set of SFTP credentials or a malformed request.');

                            return ctx.reject(['password']);
                        }

                        clientContext = {
                            request_id: Randomstring.generate(64),
                            client: ctx,
                            server: _.get(Servers, body.server),
                            token: body.token,
                            handles: {},
                            handles_count: 0,
                        };

                        return ctx.accept();
                    });
                } else {
                    return ctx.reject(['password']);
                }
            }).on('ready', () => {
                client.on('session', accept => {
                    const Session = accept();
                    Session.on('sftp', a => {
                        const sftp = a();

                        sftp.on('REALPATH', (reqId, location) => {
                            let path = _.replace(Path.resolve(clientContext.server.path(), location), clientContext.server.path(), '');
                            if (_.startsWith(path, '/')) {
                                path = path.substr(1);
                            }

                            return sftp.name(reqId, {
                                filename: `/${path}`,
                                longname: `drwxrwxrwx 2 foo foo 3 Dec 8 2009 /${path}`,
                                attrs: {},
                            });
                        });

                        sftp.on('STAT', (reqId, location) => {
                            clientContext.server.fs.stat(location, (err, item) => {
                                if (err) {
                                    if (err.code === 'ENOENT') {
                                        return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                                    }

                                    clientContext.server.log.warn({
                                        path: location,
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform a STAT operation in the SFTP server.');

                                    return sftp.status(reqId, STATUS_CODE.FAILURE);
                                }

                                return sftp.attrs(reqId, {
                                    mode: (item.directory) ? Fs.constants.S_IFDIR | 0o755 : Fs.constants.S_IFREG | 0o644,
                                    permissions: (item.directory) ? 0o755 : 0o644,
                                    uid: Config.get('docker.container.user', 1000),
                                    gid: Config.get('docker.container.user', 1000),
                                    size: item.size,
                                    atime: parseInt(Moment(item.created).format('X'), 10),
                                    mtime: parseInt(Moment(item.modified).format('X'), 10),
                                });
                            });
                        });

                        sftp.on('FSTAT', (reqId, handle) => {
                            sftp.emit('STAT', reqId, clientContext.handles[handle].path);
                        });

                        sftp.on('LSTAT', (reqId, path) => {
                            sftp.emit('STAT', reqId, path);
                        });

                        sftp.on('READDIR', (reqId, handle) => {
                            const requestData = _.get(clientContext.handles, handle, null);

                            if (requestData.done) {
                                return sftp.status(reqId, STATUS_CODE.EOF);
                            }

                            this.handleReadDir(clientContext, requestData.path, (err, attrs) => {
                                if (err) {
                                    if (err.code === 'ENOENT') {
                                        return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                                    }

                                    clientContext.server.log.warn({
                                        path: requestData.path,
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform a READDIR operation in the SFTP server.');

                                    return sftp.status(reqId, STATUS_CODE.FAILURE);
                                }

                                requestData.done = true;
                                return sftp.name(reqId, attrs);
                            });
                        });

                        sftp.on('OPENDIR', (reqId, location) => {
                            const handle = this.makeHandle(clientContext);
                            clientContext.handles[handle] = {
                                path: location,
                                done: false,
                            };

                            clientContext.handles_count += 1;

                            sftp.handle(reqId, handle);
                        });

                        sftp.on('OPEN', (reqId, location, flags) => {
                            clientContext.server.log.debug(location, flags, SftpStream.flagsToString(flags), 'OPEN');

                            const handle = this.makeHandle(clientContext);
                            const data = {
                                path: location,
                                done: false,
                            };

                            // Handle GNOME sending improper signals?
                            if (flags === 42) {
                                flags = OPEN_MODE.TRUNC | OPEN_MODE.CREAT | OPEN_MODE.WRITE; // eslint-disable-line
                            }

                            switch (SftpStream.flagsToString(flags)) {
                            case 'r':
                                data.type = OPEN_MODE.READ;
                                break;
                            case 'w':
                            case 'wx':
                                data.type = OPEN_MODE.WRITE;
                                break;
                            default:
                                clientContext.server.log.info({
                                    path: location,
                                    flag_id: flags,
                                    flag: SftpStream.flagsToString(flags),
                                    identifier: clientContext.request_id,
                                }, 'Received an unknown OPEN flag during SFTP operation.');

                                return sftp.status(reqId, STATUS_CODE.OP_UNSUPPORTED);
                            }

                            Async.series({
                                is_write: callback => {
                                    let e = null;
                                    if (data.type !== OPEN_MODE.WRITE) {
                                        e = new Error();
                                        e.code = 'E_ISREAD';
                                    }

                                    return callback(e);
                                },
                                ensure: callback => {
                                    Fs.ensureFile(clientContext.server.path(location), callback);
                                },
                                open: callback => {
                                    Fs.open(clientContext.server.path(location), 'w', 0o644, callback);
                                },
                            }, (err, results) => {
                                if (err && err.code !== 'E_ISREAD') {
                                    clientContext.server.log.warn({
                                        path: location,
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform an OPEN operation in the SFTP server.');

                                    return sftp.status(reqId, STATUS_CODE.FAILURE);
                                }

                                data.writer = _.get(results, 'open', undefined);
                                clientContext.handles[handle] = data;
                                clientContext.handles_count += 1;

                                return sftp.handle(reqId, handle);
                            });
                        });

                        sftp.on('READ', (reqId, handle, offset, length) => {
                            const requestData = _.get(clientContext.handles, handle, null);
                            if (requestData.done) {
                                return sftp.status(reqId, STATUS_CODE.EOF);
                            }

                            clientContext.server.fs.readBytes(requestData.path, offset, length, (err, data, done) => {
                                requestData.done = done || false;

                                if ((err && err.code === 'EISDIR') || done) {
                                    return sftp.status(reqId, STATUS_CODE.EOF);
                                } else if (err) {
                                    clientContext.server.log.warn({
                                        path: requestData.path,
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform a READ operation in the SFTP server.');

                                    return sftp.status(reqId, STATUS_CODE.FAILURE);
                                }

                                return sftp.data(reqId, data, 'utf8');
                            });
                        });

                        sftp.on('SETSTAT', (reqId, location, attrs) => {
                            if (_.isNull(_.get(attrs, 'mode', null))) {
                                return sftp.status(reqId, STATUS_CODE.OK);
                            }

                            Fs.chmod(clientContext.server.path(location), attrs.mode, err => {
                                if (err) {
                                    if (err.code === 'ENOENT') {
                                        return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                                    }

                                    clientContext.server.log.warn({
                                        path: location,
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform a SETSTAT (CHMOD) operation in the SFTP server.');
                                }

                                return sftp.status(reqId, err ? STATUS_CODE.FAILURE : STATUS_CODE.OK);
                            });
                        });

                        sftp.on('FSETSTAT', (reqId, handle, attrs) => {
                            sftp.emit('SETSTAT', clientContext.handles[handle].path, attrs);
                        });

                        sftp.on('WRITE', (reqId, handle, offset, data) => {
                            const requestData = _.get(clientContext.handles, handle, null);

                            // The writer is closed in the sftp.on('CLOSE') listener.
                            Fs.write(requestData.writer, data, 0, data.length, null, err => {
                                if (err) {
                                    clientContext.server.log.warn({
                                        path: requestData.path,
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform a WRITE operation in the SFTP server.');

                                    return sftp.status(reqId, STATUS_CODE.FAILURE);
                                }

                                return sftp.status(reqId, STATUS_CODE.OK);
                            });
                        });

                        sftp.on('MKDIR', (reqId, location) => {
                            Fs.ensureDir(clientContext.server.path(location), err => {
                                if (err) {
                                    clientContext.server.log.warn({
                                        path: location,
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform a MKDIR operation in the SFTP server.');
                                }

                                return sftp.status(reqId, err ? STATUS_CODE.FAILURE : STATUS_CODE.OK);
                            });
                        });

                        sftp.on('RENAME', (reqId, oldPath, newPath) => {
                            clientContext.server.fs.move(oldPath, newPath, err => {
                                if (err) {
                                    if (err.code === 'ENOENT') {
                                        return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                                    }

                                    clientContext.server.log.warn({
                                        actions: {
                                            from: oldPath,
                                            to: newPath,
                                        },
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform a RENAME operation in the SFTP server.');
                                }

                                return sftp.status(reqId, err ? STATUS_CODE.FAILURE : STATUS_CODE.OK);
                            });
                        });

                        // Remove and RmDir function the exact same in terms of how the Daemon processes
                        // the request. Simplify logic and just pass the remove event over to the rmdir handler.
                        sftp.on('REMOVE', (reqId, path) => {
                            sftp.emit('RMDIR', reqId, path);
                        });

                        sftp.on('RMDIR', (reqId, location) => {
                            clientContext.server.fs.rm(location, err => {
                                if (err) {
                                    if (err.code === 'ENOENT') {
                                        return sftp.status(reqId, STATUS_CODE.NO_SUCH_FILE);
                                    }

                                    clientContext.server.log.warn({
                                        path: location,
                                        exception: err,
                                        identifier: clientContext.request_id,
                                    }, 'An error occurred while attempting to perform a RMDIR operation in the SFTP server.');
                                }

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
                            const requestData = _.get(clientContext.handles, handle, null);
                            if (!_.isNull(requestData)) {
                                // If the writer is still active, close it and chown the item
                                // that was written.
                                if (!_.isUndefined(_.get(requestData, 'writer'))) {
                                    Fs.close(requestData.writer);
                                    clientContext.server.fs.chown(requestData.path, err => {
                                        if (err) {
                                            clientContext.server.log.warn({
                                                exception: err,
                                                identifier: clientContext.request_id,
                                            }, 'An error occurred while attempting to chown files on SFTP server.');
                                        }
                                    });
                                }

                                delete clientContext.handles[handle];
                            }

                            return sftp.status(reqId, STATUS_CODE.OK);
                        });
                    });
                });
            }).on('error', err => {
                if (err.level === 'client-timeout') {
                    return clientContext.server.log.debug({
                        identifier: clientContext.request_id,
                    }, 'Client timed out.');
                }

                clientContext.server.log.error({
                    exception: err,
                    identifier: clientContext.request_id,
                }, 'An exception was encountered while handling the SFTP subsystem.');
            });
        }).listen(Config.get('sftp.port', 2022), Config.get('sftp.ip', '0.0.0.0'), next);
    }

    makeHandle(ctx) {
        return Buffer.alloc(1, ctx.handles_count);
    }

    formatFileMode(item) {
        let longname = 'd';
        if (!item.directory) {
            longname = '-';
        }

        const permissions = _.split((item.mode & 0o777).toString(8), '');
        _.forEach(permissions, el => {
            el == 1 ? longname += '--x' : null; // eslint-disable-line
            el == 2 ? longname += '-w-' : null; // eslint-disable-line
            el == 3 ? longname += '-wx' : null; // eslint-disable-line
            el == 4 ? longname += 'r--' : null; // eslint-disable-line
            el == 5 ? longname += 'r-x' : null; // eslint-disable-line
            el == 6 ? longname += 'rw-' : null; // eslint-disable-line
            el == 7 ? longname += 'rwx' : null; // eslint-disable-line
        });

        return (item.directory) ? `${longname} 2` : `${longname} 1`;
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
                        '%s container container %d %s %s',
                        this.formatFileMode(item),
                        item.size,
                        Moment(item.created).format('MMM DD HH:mm'),
                        item.name
                    );

                    attrs.push({
                        filename: item.name,
                        longname: longFormat,
                        attrs: {
                            mode: item.mode,
                            permissions: (item.mode & 0o777).toString(8),
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
