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
const Dockerode = require('dockerode');
const _ = require('lodash');
const CIDR = require('ip-cidr');

const Log = rfr('src/helpers/logger.js');
const LoadConfig = rfr('src/helpers/config.js');

const Config = new LoadConfig();
const DockerController = new Dockerode({
    socketPath: Config.get('docker.socket', '/var/run/docker.sock'),
});

const NETWORK_NAME = Config.get('docker.network.name', 'pterodactyl_nw');

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
            Driver: Config.get('docker.network.driver', 'bridge'),
            EnableIPv6: Config.get('docker.policy.network.ipv6', true),
            Internal: Config.get('docker.policy.network.internal', false),
            IPAM: {
                Config: [
                    {
                        Subnet: Config.get('docker.network.interfaces.v4.subnet', '172.18.0.0/16'),
                        Gateway: Config.get('docker.network.interfaces.v4.gateway', '172.18.0.1'),
                    },
                    {
                        Subnet: Config.get('docker.network.interfaces.v6.subnet', 'fdba:17c8:6c94::/64'),
                        Gateway: Config.get('docker.network.interfaces.v6.gateway', 'fdba:17c8:6c94::1011'),
                    },
                ],
            },
            Options: {
                'encryption': Config.get('docker.policy.network.encryption', 'false'),
                'com.docker.network.bridge.default_bridge': 'false',
                'com.docker.network.bridge.enable_icc': Config.get('docker.policy.network.enable_icc', 'true'),
                'com.docker.network.bridge.enable_ip_masquerade': Config.get('docker.policy.network.enable_ip_masquerade', 'true'),
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

    interface(next) {
        const DockerNetwork = DockerController.getNetwork(NETWORK_NAME);
        DockerNetwork.inspect((err, data) => {
            if (err) return next(err);

            if (_.get(data, 'Driver') === 'host') {
                Log.warn('Detected daemon configuation using HOST NETWORK for server containers. This can expose the host network stack to programs running in containers!');
                Log.info('Gateway detected as 127.0.0.1 - using host network.');
                Config.modify({
                    docker: {
                        interface: '127.0.0.1',
                    },
                }, next);
                return;
            }

            if (_.get(data, 'Driver') === 'overlay') {
                Log.info('Detected daemon configuation using OVERLAY NETWORK for server containers.');
                Log.warn('Removing interface address and enabling ispn.');
                Config.modify({
                    docker: {
                        interface: '',
                        network: {
                            ispn: true,
                        },
                    },
                }, next);
                return;
            }

            if (_.get(data, 'Driver') === 'weavemesh') {
                Log.info('Detected daemon configuation using WEAVEMESH NETWORK for server containers.');
                Log.warn('Removing interface address and enabling ispn.');
                Config.modify({
                    docker: {
                        interface: '',
                        network: {
                            ispn: true,
                        },
                    },
                }, next);
                return;
            }

            if (!_.get(data, 'IPAM.Config[0].Gateway', false)) {
                return next(new Error('No gateway could be found for pterodactyl0.'));
            }

            const Gateway = new CIDR(_.get(data, 'IPAM.Config[0].Gateway', '172.18.0.1'));
            let IPGateway = null;
            if (!Gateway.isValid()) {
                return next(new Error('The pterodactyl0 network gateway is invalid.'));
            }

            const GatewayRange = Gateway.toRange();
            if (GatewayRange[0] === GatewayRange[1]) {
                IPGateway = GatewayRange[0];
            } else {
                const Split = _.split(GatewayRange[0], '.');
                Split[3] = Number(_.last(Split)) + 1;
                IPGateway = Split.join('.');
            }

            Log.info(`Networking gateway detected as ${IPGateway} for interface: pterodactyl0.`);
            Config.modify({
                docker: {
                    interface: IPGateway,
                },
            }, next);
        });
    }
}

module.exports = Network;
