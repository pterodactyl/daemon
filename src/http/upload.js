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
const binaryJS = require('binaryjs').BinaryServer;
const Fs = require('fs-extra');
const Path = require('path');

const ConfigHelper = rfr('src/helpers/config.js');
const RestServer = rfr('src/http/restify.js');

const Config = new ConfigHelper();
const BinaryServer = binaryJS({
    server: RestServer,
    chunkSize: 40960,
    path: '/upload/',
});

class Upload {
    constructor(server) {
        this.server = server;
    }

    init() {
        const self = this;
        // Prevents a scary looking error from NodeJS about possible
        // memory leak. There is no leak. (only leeks!)
        BinaryServer.removeAllListeners('connection');

        BinaryServer.on('connection', function initBinaryServerConnection(client) {
            client.on('stream', function initBinaryServerConnectionStream(stream, meta) {
                if (!meta.token || !meta.server) {
                    stream.write({ 'error': 'Missing required meta variables in the request.' });
                    stream.end();
                    return;
                }

                if (!self.server.hasPermission('s:files:upload', meta.token)) {
                    stream.write({ 'error': 'You do not have permission to upload files to this server.' });
                    stream.end();
                    return;
                }

                if (meta.size > Config.get('uploads.maximumSize', 1000000)) {
                    stream.write({ 'error': 'That file is too big to upload.' });
                    stream.end();
                    return;
                }

                Fs.ensureDir(self.server.path(meta.path), function (err) {
                    if (err) {
                        this.server.log.error(err);
                        return;
                    }

                    // Write uploaded file to server
                    const FileWritter = Fs.createWriteStream(self.server.path(Path.join(meta.path, meta.name)));
                    stream.pipe(FileWritter);
                    stream.on('data', function (data) {
                        stream.write({ rx: data.length / meta.size });
                    });
                });
            });
        });
    }
}

module.exports = Upload;
