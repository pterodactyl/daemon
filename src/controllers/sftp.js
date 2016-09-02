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

const LoadConfig = rfr('src/helpers/config.js');
const Dockerode = require('dockerode');
const _ = require('lodash');

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

// docker run -d --name sftp -v /srv/data:/sftp-root -v /srv/daemon/config/credentials:/creds -p 2022:22 quay.io/pterodactyl/scrappy
class SFTP {
    constructor() {
        this.container = DockerController.getContainer(Config.get('sftp.container'));
    }

    /**
     * Starts the SFTP container on the system.
     * @param  {Function} next [description]
     * @return {[type]}        [description]
     */
    startService(next) {
        this.container.start(function sftpContainerStart(err) {
            // Container is already running, we can just continue on and pretend we started it just now.
            if (err && _.includes(err.message, 'HTTP code is 304 which indicates error: container already started')) {
                return next();
            }
            return next(err);
        });
    }

    /**
     * Creates a new SFTP user on the system.
     * @param  string     username
     * @param  password   password
     * @param  {Function} next
     * @return {Callback}
     */
    create(username, password, next) {
        this._doExec(['scrappyuser', '-u', username, '-p', password], function (err) {
            return next(err);
        });
    }

    /**
     * Updates the password for a SFTP user on the system.
     * @param  string     username
     * @param  string   password
     * @param  {Function} next
     * @return {Callback}
     */
    password(username, password, next) {
        this._doExec(['scrappypwd', '-u', username, '-p', password], function (err) {
            return next(err);
        });
    }

    /**
     * Gets the UID for a specified user.
     * @param  string   username
     * @param  {Function} next
     * @return {[type]}]
     */
    uid(username, next) {
        this._doExec(['id', '-u', username], function (err, userid) {
            return next(err, userid);
        });
    }

    /**
     * Deletes the specified user and folders from the container.
     * @param  string   username
     * @param  {Function} next
     * @return {[type]}]
     */
    delete(username, next) {
        this._doExec(['scrappydel', '-u', username], function (err) {
            return next(err);
        });
    }

    /**
     * Locks an account to prevent SFTP access. Used for server suspension.
     * @param   string    username
     * @param   {Function} next
     * @return  void
     */
    lock(username, next) {
        this._doExec(['passwd', '-l', username], function (err) {
            return next(err);
        });
    }

    /**
     * Unlocks an account to allow SFTP access. Used for server unsuspension.
     * @param   string    username
     * @param   {Function} next
     * @return  void
     */
    unlock(username, next) {
        this._doExec(['passwd', '-u', username], function (err) {
            return next(err);
        });
    }

    /**
     * Handles passing execution to the container for create and password.
     * @param  array     command
     * @param  {Function} next
     * @return {Callback}
     */
    _doExec(command, next) {
        let uidResponse = null;
        this.container.exec({
            Cmd: command,
            AttachStdin: true,
            AttachStdout: true,
            Tty: true,
        }, function sftpExec(err, exec) {
            if (err) return next(err);
            exec.start(function sftpExecStreamStart(execErr, stream) {
                if (!execErr && stream) {
                    stream.setEncoding('utf8');
                    stream.on('data', function sftpExecStreamData(data) {
                        if (/^(\d{5})$/.test(data.replace(/[\x00-\x1F\x7F-\x9F]/g, ''))) {
                            uidResponse = data.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
                        }
                    });
                    stream.on('end', function sftpExecStreamEnd() {
                        exec.inspect(function sftpExecInspect(inspectErr, data) {
                            if (inspectErr) return next(inspectErr);
                            if (data.ExitCode !== 0) {
                                return next(new Error('Docker returned a non-zero exit code when attempting to execute a SFTP command.'));
                            }
                            return next(null, uidResponse);
                        });
                    });
                } else {
                    return next(execErr);
                }
            });
        });
    }
}

module.exports = SFTP;
