'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
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
