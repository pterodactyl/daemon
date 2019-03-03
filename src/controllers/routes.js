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
const Async = require('async');
const Request = require('request');
const Util = require('util');
const Fs = require('fs-extra');
const Mime = require('mime');
const Path = require('path');
const Crypto = require('crypto');
const _ = require('lodash');
const Os = require('os');
const Cache = require('memory-cache');

const Status = require('./../helpers/status');
const ConfigHelper = require('./../helpers/config');
const ResponseHelper = require('./../helpers/responses');
const BuilderController = require('./../controllers/builder');
const DeleteController = require('./../controllers/delete');
const Log = require('./../helpers/logger');
const Package = require('./../../package');

const Config = new ConfigHelper();

class RouteController {
    constructor(auth, req, res) {
        this.req = req;
        this.res = res;

        this.auth = auth;
        this.responses = new ResponseHelper(req, res);
    }

    // Returns Index
    getIndex() {
        this.auth.allowed('c:info', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

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
        });
    }

    // Revoke an authentication key on demand
    revokeKey() {
        this.auth.allowed('c:revoke-key', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            const key = _.get(this.req.params, 'key');
            Log.debug({ token: key }, 'Revoking authentication token per manual request.');
            Cache.del(`auth:token:${key}`);

            return this.responses.generic204(null);
        });
    }

    // Similar to revokeKey except it allows for multiple keys at once
    batchDeleteKeys() {
        this.auth.allowed('c:revoke-key', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            _.forEach(_.get(this.req.params, 'keys'), key => {
                Log.debug({ token: key }, 'Revoking authentication token per batch delete request.');
                Cache.del(`auth:token:${key}`);
            });

            return this.responses.generic204(null);
        });
    }

    // Updates saved configuration on system.
    patchConfig() {
        this.auth.allowed('c:config', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            Config.modify(this.req.params, err => {
                this.responses.generic204(err);
            });
        });
    }

    // Saves Daemon Configuration to Disk
    putConfig() {
        this.auth.allowed('c:config', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            Config.save(this.req.params, err => {
                this.responses.generic204(err);
            });
        });
    }

    postNewServer() {
        this.auth.allowed('c:create', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            const startOnCompletion = _.get(this.req.params, 'start_on_completion', false);
            if (startOnCompletion) {
                delete this.req.params.start_on_completion;
            }

            const Builder = new BuilderController(this.req.params);
            this.res.send(202, { 'message': 'Server is being built now, this might take some time if the docker image doesn\'t exist on the system yet.' });

            // We sent a HTTP 202 since this might take awhile.
            // We do need to monitor for errors and negatiate with
            // the panel if they do occur.
            Builder.init((err, data) => {
                if (err) Log.fatal({ err: err, meta: _.get(err, 'meta') }, 'A fatal error was encountered while attempting to create a server.'); // eslint-disable-line

                const HMAC = Crypto.createHmac('sha256', Config.get('keys.0'));
                HMAC.update(data.uuid);

                Request.post(`${Config.get('remote.base')}/daemon/install`, {
                    form: {
                        server: data.uuid,
                        signed: HMAC.digest('base64'),
                        installed: (err) ? 'error' : 'installed',
                    },
                    headers: {
                        'X-Access-Node': Config.get('keys.0'),
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                    },
                    followAllRedirects: true,
                    timeout: 5000,
                }, (requestErr, response, body) => {
                    if (requestErr || response.statusCode !== 200) {
                        Log.warn(requestErr, 'An error occured while attempting to alert the panel of server install status.', { code: (typeof response !== 'undefined') ? response.statusCode : null, responseBody: body });
                    } else {
                        Log.info('Notified remote panel of server install status.');
                    }

                    if (startOnCompletion && !err) {
                        const Servers = rfr('src/helpers/initialize.js').Servers;
                        Servers[data.uuid].start(startErr => {
                            if (err) Log.error({ server: data.uuid, err: startErr }, 'There was an error while attempting to auto-start this server.');
                        });
                    }
                });
            });
        });
    }

    getAllServers() {
        this.auth.allowed('c:list', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            const responseData = {};
            Async.each(this.auth.allServers(), (server, callback) => {
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
        });
    }

    deleteServer() {
        this.auth.allowed('g:server:delete', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            const Delete = new DeleteController(this.auth.server().json);
            Delete.delete(err => {
                this.responses.generic204(err);
            });
        });
    }

    // Handles server power
    putServerPower() {
        if (this.req.params.action === 'start') {
            this.auth.allowed('s:power:start', (allowedErr, isAllowed) => {
                if (allowedErr || !isAllowed) return;

                this.auth.server().start(err => {
                    if (err && (
                        _.includes(err.message, 'Server is currently queued for a container rebuild') ||
                        _.includes(err.message, 'Server container was not found and needs to be rebuilt.') ||
                        _.startsWith(err.message, 'Server is already running')
                    )) {
                        return this.res.send(202, { 'message': err.message });
                    }

                    this.responses.generic204(err);
                });
            });
        } else if (this.req.params.action === 'stop') {
            this.auth.allowed('s:power:stop', (allowedErr, isAllowed) => {
                if (allowedErr || !isAllowed) return;

                this.auth.server().stop(err => {
                    this.responses.generic204(err);
                });
            });
        } else if (this.req.params.action === 'restart') {
            this.auth.allowed('s:power:restart', (allowedErr, isAllowed) => {
                if (allowedErr || !isAllowed) return;

                this.auth.server().restart(err => {
                    if (err && (_.includes(err.message, 'Server is currently queued for a container rebuild') || _.includes(err.message, 'Server container was not found and needs to be rebuilt.'))) {
                        return this.res.send(202, { 'message': err.message });
                    }
                    this.responses.generic204(err);
                });
            });
        } else if (this.req.params.action === 'kill') {
            this.auth.allowed('s:power:kill', (allowedErr, isAllowed) => {
                if (allowedErr || !isAllowed) return;

                this.auth.server().kill(err => {
                    if (err && _.startsWith(err.message, 'Server is already stopped')) {
                        return this.res.send(202, { 'message': err.message });
                    }

                    this.responses.generic204(err);
                });
            });
        } else {
            this.res.send(404, { 'error': 'Unknown power action recieved.' });
        }
    }

    reinstallServer() {
        this.auth.allowed('c:install-server', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().reinstall(this.req.params, err => {
                if (err) Log.error(err);

                const HMAC = Crypto.createHmac('sha256', Config.get('keys.0'));
                HMAC.update(this.auth.serverUuid());

                Request.post(`${Config.get('remote.base')}/daemon/install`, {
                    form: {
                        server: this.auth.serverUuid(),
                        signed: HMAC.digest('base64'),
                        installed: (err) ? 'error' : 'installed',
                    },
                    headers: {
                        'X-Access-Node': Config.get('keys.0'),
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
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

            this.res.send(202, { 'message': 'Server is being reinstalled.' });
        });
    }

    getServer() {
        this.auth.allowed('s:console', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.res.send({
                // container: this.auth.server().json.container,
                // service: this.auth.server().json.service,
                status: this.auth.server().status,
                query: this.auth.server().processData.query,
                proc: this.auth.server().processData.process,
            });
        });
    }

    // Sends command to server
    postServerCommand() {
        this.auth.allowed('s:command', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            if (this.auth.server().status === Status.OFF) {
                return this.res.send(412, {
                    'error': 'Server is not running.',
                    'route': this.req.path,
                    'req_id': this.req.id,
                    'type': this.req.contentType,
                });
            }

            if (!_.isUndefined(this.req.params.command)) {
                this.auth.server().command(this.req.params.command).then(() => {
                    this.responses.generic204();
                }).catch(err => {
                    this.responses.generic500(err);
                });
            } else {
                this.res.send(500, { 'error': 'Missing command in request.' });
            }
        });
    }

    // Returns listing of server files.
    getServerDirectory() {
        this.auth.allowed('s:files:get', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.directory(this.req.params[0], (err, data) => {
                if (err) {
                    switch (err.code) {
                    case 'ENOENT':
                        return this.res.send(404);
                    default:
                        return this.responses.generic500(err);
                    }
                }
                return this.res.send(data);
            });
        });
    }

    // Return file contents
    getServerFile() {
        this.auth.allowed('s:files:read', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.read(this.req.params[0], (err, data) => {
                if (err) {
                    switch (err.code) {
                    case 'ENOENT':
                        return this.res.send(404);
                    default:
                        return this.responses.generic500(err);
                    }
                }
                return this.res.send({ content: data });
            });
        });
    }

    getServerLog() {
        this.auth.allowed('s:console', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.readEnd(this.auth.server().service.object.log.location, (err, data) => {
                if (err) {
                    return this.responses.generic500(err);
                }
                return this.res.send(data);
            });
        });
    }

    getServerFileStat() {
        this.auth.allowed('s:files:read', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.stat(this.req.params[0], (err, data) => {
                if (err) {
                    switch (err.code) {
                    case 'ENOENT':
                        return this.res.send(404);
                    default:
                        return this.responses.generic500(err);
                    }
                }
                return this.res.send(data);
            });
        });
    }

    postFileFolder() {
        this.auth.allowed('s:files:create', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.mkdir(this.req.params.path, err => {
                this.responses.generic204(err);
            });
        });
    }

    postFileCopy() {
        this.auth.allowed('s:files:copy', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.copy(this.req.params.from, this.req.params.to, err => {
                this.responses.generic204(err);
            });
        });
    }

    // prevent breaking API change for now.
    deleteServerFile() {
        this.auth.allowed('s:files:delete', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.rm(this.req.params[0], err => {
                this.responses.generic204(err);
            });
        });
    }

    postFileDelete() {
        this.auth.allowed('s:files:delete', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.rm(this.req.params.items, err => {
                this.responses.generic204(err);
            });
        });
    }

    postFileMove() {
        this.auth.allowed('s:files:move', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.move(this.req.params.from, this.req.params.to, err => {
                this.responses.generic204(err);
            });
        });
    }

    postFileDecompress() {
        this.auth.allowed('s:files:decompress', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.decompress(this.req.params.files, err => {
                this.responses.generic204(err);
            });
        });
    }

    postFileCompress() {
        this.auth.allowed('s:files:compress', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.compress(this.req.params.files, this.req.params.to, (err, filename) => {
                if (err) {
                    return this.responses.generic500(err);
                }
                return this.res.send({
                    saved_as: filename,
                });
            });
        });
    }

    postServerFile() {
        this.auth.allowed('s:files:post', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().fs.write(this.req.params.path, this.req.params.content, err => {
                this.responses.generic204(err);
            });
        });
    }

    updateServerConfig() {
        this.auth.allowed('g:server:patch', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().modifyConfig(this.req.params, (this.req.method === 'PUT'), err => {
                this.responses.generic204(err);
            });
        });
    }

    rebuildServer() {
        this.auth.allowed('g:server:rebuild', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().modifyConfig({ rebuild: true }, false, err => {
                this.responses.generic204(err);
            });
        });
    }

    postServerSuspend() {
        this.auth.allowed('g:server:suspend', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().suspend(err => {
                this.responses.generic204(err);
            });
        });
    }

    postServerUnsuspend() {
        this.auth.allowed('g:server:unsuspend', (allowedErr, isAllowed) => {
            if (allowedErr || !isAllowed) return;

            this.auth.server().unsuspend(err => {
                this.responses.generic204(err);
            });
        });
    }

    downloadServerFile() {
        Request(`${Config.get('remote.base')}/api/remote/download-file`, {
            method: 'POST',
            json: {
                token: this.req.params.token,
            },
            headers: {
                'Accept': 'application/vnd.pterodactyl.v1+json',
                'Authorization': `Bearer ${Config.get('keys.0')}`,
            },
            timeout: 5000,
        }, (err, response, body) => {
            if (err) {
                Log.warn(err, 'Download action failed due to an error with the request.');
                return this.res.send(500, { 'error': 'An error occured while attempting to perform this request.' });
            }

            if (response.statusCode === 200) {
                try {
                    const json = _.isString(body) ? JSON.parse(body) : body;
                    if (!_.isUndefined(json) && json.path) {
                        const Server = this.auth.allServers();
                        // Does the server even exist?
                        if (_.isUndefined(Server[json.server])) {
                            return this.res.send(404, { 'error': 'No server found for the specified resource.' });
                        }

                        // Get necessary information for the download.
                        const Filename = Path.basename(json.path);
                        const Mimetype = Mime.getType(json.path);
                        const File = Server[json.server].path(json.path);
                        const Stat = Fs.statSync(File);
                        if (!Stat.isFile()) {
                            return this.res.send(404, { 'error': 'Could not locate the requested file.' });
                        }

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
                if (response.statusCode >= 500) {
                    Log.warn({ res_code: response.statusCode, res_body: body }, 'An error occured while attempting to retrieve file download information for an upstream provider.');
                }

                this.res.redirect(this.req.header('Referer') || Config.get('remote.base'), _.constant(''));
            }
        });
    }
}

module.exports = RouteController;
