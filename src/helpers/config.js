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
const Async = require('async');
const Fs = require('fs-extra');
const Proc = require('child_process');
const _ = require('lodash');
const extendify = require('extendify');

class Config {

    constructor() {
        this.configJson = this._raw();
        this.docker0 = null;
    }

    _raw() {
        return Fs.readJsonSync('./config/core.json');
    }

    get(key, defaultResponse) {
        let getObject;
        try {
            this.configJson = this._raw(); // Without this things don't ever end up updated...
            // getObject = key.split('.').reduce((o, i) => o[i], this.configJson);
            getObject = _.reduce(key.split('.'), function (o, i) {
                return o[i];
            }, this.configJson);
        } catch (ex) {
            //
        }

        if (typeof getObject !== 'undefined') {
            return getObject;
        }

        return (typeof defaultResponse !== 'undefined') ? defaultResponse : undefined;
    }

    save(json, next) {
        const self = this;
        if (!json || !_.isObject(json) || json === null || !_.keys(json).length) {
            throw new Error('Invalid JSON was passed to Builder.');
        }

        Fs.writeJson('./config/core.json', json, function (err) {
            if (!err) self.configJson = json;
            return next(err);
        });
    }

    modify(object, next) {
        if (!_.isObject(object)) return next(new Error('Function expects an object to be passed.'));

        const deepExtend = extendify({
            inPlace: false,
            arrays: 'replace',
        });
        Fs.writeJson('./config/core.json', deepExtend(this._raw(), object), function (err) {
            return next(err);
        });
    }

    initDockerInterface(next) {
        const self = this;
        Async.waterfall([
            function configDockerInterfaceGetIp(callback) {
                Proc.exec('ifconfig docker0 | grep \'inet addr\' | cut -d: -f2 | awk \'{print $1}\'', function (err, stdout) {
                    if (err) return callback(err);
                    if (!stdout) return callback(new Error('Unable to establish the current docker0 interface IP address.'));
                    return callback(null, stdout);
                });
            },
            function configDockerInterfaceSetIp(ip, callback) {
                const config = self._raw();
                config.docker.interface = ip.replace(/(\n|\r)+$/, '');
                Fs.writeJson('./config/core.json', config, callback);
            },
        ], function (err) {
            return next(err);
        });
    }

}

module.exports = Config;
