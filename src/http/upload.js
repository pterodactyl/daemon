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
const rfr = require('rfr');
const Siofu = require('socketio-file-upload');
const Fs = require('fs-extra');
const _ = require('lodash');

const ConfigHelper = rfr('src/helpers/config.js');
const Socket = rfr('src/http/socket.js').Socket;

const Config = new ConfigHelper();

class Upload {
    constructor(server) {
        this.server = server;
        this.websocket = Socket.of(`/v1/upload/${this.server.json.uuid}`);

        // Standard Websocket Permissions
        this.websocket.use((params, next) => {
            if (!params.handshake.query.token) {
                return next(new Error('You must pass the correct handshake values.'));
            }

            this.server.hasPermission('s:files:upload', params.handshake.query.token, (err, hasPermission) => {
                if (err || !hasPermission) {
                    return next(new Error('You do not have permission to upload files to this server.'));
                }

                return next();
            });
        });
    }

    init() {
        this.websocket.on('connection', socket => {
            const Uploader = new Siofu();
            Uploader.listen(socket);

            Uploader.on('start', event => {
                Uploader.maxFileSize = (Config.get('uploads.size_limit', 100)) * (1000 * 1000);
                Uploader.dir = this.server.path(event.file.meta.path);

                if (event.file.size > Uploader.maxFileSize) {
                    Uploader.abort(event.file.id, socket);
                }
            });

            Uploader.on('saved', event => {
                if (!event.file.success) {
                    this.server.log.warn('An error was encountered while attempting to save a file (or the network operation was interrupted).', event);

                    Fs.remove(event.file.pathName);
                    return;
                }

                this.server.fs.chown(event.file.pathName, err => {
                    if (err) this.server.log.warn(err);
                });
            });

            Uploader.on('error', event => {
                if (_.startsWith(event.memo, 'disconnect during upload') || _.startsWith(event.error.code, 'ENOENT')) return;
                this.server.log.error('There was an error while attempting to process a file upload.', event);
            });
        });
    }
}

module.exports = Upload;
