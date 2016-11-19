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
const Request = require('request');
const Util = require('util');
const Fs = require('fs-extra');
const Mime = require('mime');
const Path = require('path');
const Crypto = require('crypto');
const _ = require('lodash');
const Os = require('os');

const ConfigHelper = rfr('src/helpers/config.js');
const ResponseHelper = rfr('src/helpers/responses.js');
const BuilderController = rfr('src/controllers/builder.js');
const DeleteController = rfr('src/controllers/delete.js');
const Log = rfr('src/helpers/logger.js');
const Package = rfr('package.json');

const Config = new ConfigHelper();
let Responses;
let Auth;

class RouteController {
    constructor(auth, req, res) {
        this.req = req;
        this.res = res;
        Auth = auth;
        Responses = new ResponseHelper(req, res);
    }

    // Returns Index
    getIndex() {
        if (!Auth.allowed('g:info')) return;
        this.res.send({
            name: 'Pterodactyl Management Daemon',
            version: Package.version,
            system: {
                type: Os.type(),
                arch: Os.arch(),
                platform: Os.platform(),
                release: Os.release(),
                cpus: Os.cpus().length,
                freemem: Os.freemem(),
            },
            network: Os.networkInterfaces(),
        });
    }

    // Saves Daemon Configuration to Disk
    putConfig() {
        if (!Auth.allowed('c:config')) return;
        Config.save(this.req.params, err => {
            if (err) return this.res.send(500, { 'error': err.message });
            return this.res.send(204);
        });
    }

    postNewServer() {
        if (!Auth.allowed('c:create')) return;
        const Builder = new BuilderController(this.req.params);
        this.res.send(202, { 'message': 'Server is being built now, this might take some time if the docker image doesn\'t exist on the system yet.' });

        // We sent a HTTP 202 since this might take awhile.
        // We do need to monitor for errors and negatiate with
        // the panel if they do occur.
        Builder.init((err, data) => {
            if (err) Log.error(err);

            const HMAC = Crypto.createHmac('sha256', Config.get('keys.0'));
            HMAC.update(data.uuid);

            Request.post(Config.get('remote.installed'), {
                form: {
                    server: data.uuid,
                    signed: HMAC.digest('base64'),
                    installed: (err) ? 'error' : 'installed',
                },
                followAllRedirects: true,
                timeout: 5000,
            }, (requestErr, response, body) => {
                if (requestErr || response.statusCode !== 200) {
                    Log.warn(requestErr, 'An error occured while attempting to alert the panel of server install status.', { code: (typeof response !== 'undefined') ? response.statusCode : null, responseBody: body });
                } else {
                    Log.info('Notified remote panel of server install status.');
                }
            });
        });
    }

    getAllServers() {
        if (!Auth.allowed('c:list')) return;
        const responseData = {};
        Async.each(Auth.allServers(), (server, callback) => {
            responseData[server.json.uuid] = {
                container: server.json.container,
                service: server.json.service,
                status: server.status,
                query: server.processData.query,
                proc: server.processData.process,
            };
            callback();
        }, () => {
            this.res.send(responseData);
        });
    }

    deleteServer() {
        if (!Auth.allowed('g:server:delete')) return;
        const Delete = new DeleteController(Auth.server().json);
        Delete.delete(err => {
            Responses.generic204(err);
        });
    }

    // Handles server power
    putServerPower() {
        if (this.req.params.action === 'start') {
            if (!Auth.allowed('s:power:start')) return;
            Auth.server().start(err => {
                if (err && (_.includes(err.message, 'Server is currently queued for a container rebuild') || _.includes(err.message, 'Server container was not found and needs to be rebuilt.'))) {
                    return this.res.send(202, { 'message': err.message });
                }
                Responses.generic204(err);
            });
        } else if (this.req.params.action === 'stop') {
            if (!Auth.allowed('s:power:stop')) return;
            Auth.server().stop(err => {
                Responses.generic204(err);
            });
        } else if (this.req.params.action === 'restart') {
            if (!Auth.allowed('s:power:restart')) return;
            Auth.server().restart(err => {
                if (err && (_.includes(err.message, 'Server is currently queued for a container rebuild') || _.includes(err.message, 'Server container was not found and needs to be rebuilt.'))) {
                    return this.res.send(202, { 'message': err.message });
                }
                Responses.generic204(err);
            });
        } else if (this.req.params.action === 'kill') {
            if (!Auth.allowed('s:power:kill')) return;
            Auth.server().kill(err => {
                Responses.generic204(err);
            });
        } else {
            this.res.send(404, { 'error': 'Unknown power action recieved.' });
        }
    }

    getServer() {
        if (!Auth.allowed('s:get')) return;
        this.res.send({
            container: Auth.server().json.container,
            service: Auth.server().json.service,
            status: Auth.server().status,
            query: Auth.server().processData.query,
            proc: Auth.server().processData.process,
        });
    }

    // Sends command to server
    postServerCommand() {
        if (!Auth.allowed('s:command')) return;
        if (!_.isUndefined(this.req.params.command)) {
            if (this.req.params.command.trim().replace(/^\/*/, '').startsWith(Auth.server().service.object.stop)) {
                if (!Auth.allowed('s:power:stop')) return;
            }
            Auth.server().command(this.req.params.command, err => {
                Responses.generic204(err);
            });
        } else {
            this.res.send(500, { 'error': 'Missing command in request.' });
        }
    }

    // Returns listing of server files.
    getServerDirectory() {
        if (!Auth.allowed('s:files:get')) return;
        if (!this.req.params[0]) this.req.params[0] = '.';
        Auth.server().fs.directory(this.req.params[0], (err, data) => {
            if (err) {
                return Responses.generic500(err);
            }
            return this.res.send(data);
        });
    }

    // Return file contents
    getServerFile() {
        if (!Auth.allowed('s:files:read')) return;
        Auth.server().fs.read(this.req.params[0], (err, data) => {
            if (err) {
                return Responses.generic500(err);
            }
            return this.res.send({ content: data });
        });
    }

    getServerLog() {
        if (!Auth.allowed('s:console')) return;
        Auth.server().fs.readEnd(Auth.server().service.object.log.location, (err, data) => {
            if (err) {
                return Responses.generic500(err);
            }
            return this.res.send(data);
        });
    }

    getServerFileStat() {
        if (!Auth.allowed('s:files:read')) return;
        Auth.server().fs.stat(this.req.params[0], (err, data) => {
            if (err) {
                return Responses.generic500(err);
            }
            return this.res.send(data);
        });
    }

    postFileFolder() {
        if (!Auth.allowed('s:files:create')) return;
        Auth.server().fs.mkdir(this.req.params.path, err => {
            Responses.generic204(err);
        });
    }

    postFileCopy() {
        if (!Auth.allowed('s:files:copy')) return;
        Auth.server().fs.copy(this.req.params.from, this.req.params.to, err => {
            Responses.generic204(err);
        });
    }

    postFileMove() {
        if (!Auth.allowed('s:files:move')) return;
        Auth.server().fs.move(this.req.params.from, this.req.params.to, err => {
            Responses.generic204(err);
        });
    }

    postFileDecompress() {
        if (!Auth.allowed('s:files:decompress')) return;
        Auth.server().fs.decompress(this.req.params.files, err => {
            Responses.generic204(err);
        });
    }

    postFileCompress() {
        if (!Auth.allowed('s:files:compress')) return;
        Auth.server().fs.compress(this.req.params.files, this.req.params.to, (err, filename) => {
            if (err) {
                return Responses.generic500(err);
            }
            return this.res.send({
                saved_as: filename,
            });
        });
    }

    postServerFile() {
        if (!Auth.allowed('s:files:post')) return;
        Auth.server().fs.write(this.req.params.path, this.req.params.content, err => {
            Responses.generic204(err);
        });
    }

    deleteServerFile() {
        if (!Auth.allowed('s:files:delete')) return;
        Auth.server().fs.delete(this.req.params[0], err => {
            Responses.generic204(err);
        });
    }

    updateServerConfig() {
        if (!Auth.allowed('g:server:patch')) return;
        Auth.server().modifyConfig(this.req.params, (this.req.method === 'PUT'), err => {
            Responses.generic204(err);
        });
    }

    rebuildServer() {
        if (!Auth.allowed('g:server:rebuild')) return;
        Auth.server().modifyConfig({ rebuild: true }, false, err => {
            Responses.generic204(err);
        });
    }

    setSFTPPassword() {
        if (!Auth.allowed('s:set-password')) return;
        Auth.server().setPassword(this.req.params.password, err => {
            Responses.generic204(err);
        });
    }

    postServerSuspend() {
        if (!Auth.allowed('g:server:suspend')) return;
        Auth.server().suspend(err => {
            Responses.generic204(err);
        });
    }

    postServerUnsuspend() {
        if (!Auth.allowed('g:server:unsuspend')) return;
        Auth.server().unsuspend(err => {
            Responses.generic204(err);
        });
    }

    downloadServerFile() {
        if (!Config.get('remote.download')) {
            return this.res.send(501, { 'error': 'This action has not been properly configured on the daemon.' });
        }

        Request.post(Config.get('remote.download'), {
            form: {
                token: this.req.params[0],
            },
            timeout: 5000,
        }, (err, response, body) => {
            if (err) {
                Log.warn(err, 'Download action failed due to an error with the request.');
                return this.res.send(500, { 'error': 'An error occured while attempting to perform this request.' });
            }

            if (response.statusCode === 200) {
                try {
                    const json = JSON.parse(body);
                    if (typeof json !== 'undefined' && json.path) {
                        const Server = Auth.allServers();
                        // Does the server even exist?
                        if (_.isUndefined(Server[json.server])) {
                            return this.res.send(404, { 'error': 'No server found for the specified resource.' });
                        }

                        // Get necessary information for the download.
                        const Filename = Path.basename(json.path);
                        const Mimetype = Mime.lookup(json.path);
                        const File = Server[json.server].path(json.path);
                        const Stat = Fs.statSync(File);
                        this.res.writeHead(200, {
                            'Content-Type': Mimetype,
                            'Content-Length': Stat.size,
                            'Content-Disposition': Util.format('attachment; filename=%s', Filename),
                        });
                        const Filestream = Fs.createReadStream(File);
                        Filestream.pipe(this.res);
                    } else {
                        return this.res.send(424, { 'error': 'The upstream response did not include a valid download path.' });
                    }
                } catch (ex) {
                    Log.error(ex);
                    return this.res.send(500, { 'error': 'An unexpected error occured while attempting to process this request.' });
                }
            } else {
                return this.res.send(502, { 'error': 'An error occured while attempting to authenticate with an upstream provider.', res_code: response.statusCode });
            }
        });
    }
}

module.exports = RouteController;
