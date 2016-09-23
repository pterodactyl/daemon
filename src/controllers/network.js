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
const NETWORK_NAME = 'pterodactyl_nw';

const rfr = require('rfr');
const Dockerode = require('dockerode');
const _ = require('lodash');

const Log = rfr('src/helpers/logger.js');
const LoadConfig = rfr('src/helpers/config.js');

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

class Network {

    // Initalization Sequence for Networking
    // Called when Daemon boots.
    init(next) {
        DockerController.listNetworks((err, networks) => {
            if (err) return next(err);
            const foundNetwork = _.find(networks, values => {
                if (values.Name === NETWORK_NAME) return values.Name;
            });

            if (!_.isUndefined(foundNetwork)) {
                Log.info(`Found network interface for daemon: ${NETWORK_NAME}`);
                return next();
            }
            this.buildNetwork(next);
        });
    }

    // Builds the isolated network for containers.
    buildNetwork(next) {
        Log.warn('No isolated network interface for containers was detected, creating one now.');
        DockerController.createNetwork({
            Name: NETWORK_NAME,
            Driver: 'bridge',
            EnableIPv6: true,
            Internal: false,
            Options: {
                'com.docker.network.bridge.default_bridge': 'false',
                'com.docker.network.bridge.enable_icc': 'false',
                'com.docker.network.bridge.enable_ip_masquerade': 'true',
                'com.docker.network.bridge.host_binding_ipv4': '0.0.0.0',
                'com.docker.network.bridge.name': 'pterodactyl0',
                'com.docker.network.driver.mtu': '1500',
            },
        }, err => {
            if (err) return next(err);
            Log.info(`Successfully created new network (${NETWORK_NAME}) on pterodactyl0 for isolated containers.`);
            return next();
        });
    }
}

module.exports = Network;
