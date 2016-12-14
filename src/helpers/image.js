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
const Dockerode = require('dockerode');
const _ = require('lodash');

const LoadConfig = rfr('src/helpers/config.js');

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

class DockerImage {

    /**
     * Determines if an image exists.
     * @return boolean
     */
    static exists(img, next) {
        const Image = DockerController.getImage(img);
        Image.inspect(next);
    }

    /**
     * Pulls an image to the server.
     * @param  string       image
     * @param  {Function}   next
     * @return {Function}
     */
    static pull(image, next) {
        let pullWithConfig = {};
        if (_.isObject(Config.get('docker.registry', false))) {
            if (Config.get('docker.registry.key', false)) {
                pullWithConfig = {
                    authconfig: {
                        key: Config.get('docker.registry.key', ''),
                    },
                };
            } else {
                pullWithConfig = {
                    authconfig: {
                        username: Config.get('docker.registry.username', ''),
                        password: Config.get('docker.registry.password', ''),
                        auth: Config.get('docker.registry.auth', ''),
                        email: Config.get('docker.registry.email', ''),
                        serveraddress: Config.get('docker.registry.serveraddress', ''),
                    },
                };
            }
        }

        DockerController.pull(image, pullWithConfig, (err, stream) => {
            if (err) return next(err);
            stream.setEncoding('utf8');
            stream.on('data', () => { _.noop(); });
            stream.on('end', next);
            stream.on('error', next);
        });
    }
}

module.exports = DockerImage;
