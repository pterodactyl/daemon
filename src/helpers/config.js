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
        this.configJson = this.raw();
        this.docker0 = null;
    }

    raw() {
        return Fs.readJsonSync('./config/core.json');
    }

    get(key, defaultResponse) {
        let getObject;
        try {
            this.configJson = this.raw(); // Without this things don't ever end up updated...
            getObject = _.reduce(key.split('.'), (o, i) => o[i], this.configJson);
        } catch (ex) {
            //
        }

        if (!_.isUndefined(getObject)) {
            return getObject;
        }

        return (!_.isUndefined(defaultResponse)) ? defaultResponse : undefined;
    }

    save(json, next) {
        if (!json || !_.isObject(json) || _.isNull(json) || !_.keys(json).length) {
            throw new Error('Invalid JSON was passed to Builder.');
        }

        Fs.writeJson('./config/core.json', json, err => {
            if (!err) this.configJson = json;
            return next(err);
        });
    }

    modify(object, next) {
        if (!_.isObject(object)) return next(new Error('Function expects an object to be passed.'));

        const deepExtend = extendify({
            inPlace: false,
            arrays: 'replace',
        });
        Fs.writeJson('./config/core.json', deepExtend(this.raw(), object), next);
    }

    initDockerInterface(next) {
        Async.waterfall([
            callback => {
                Proc.exec('ifconfig docker0 | grep \'inet addr\' | cut -d: -f2 | awk \'{print $1}\'', (err, stdout) => {
                    if (err) return callback(err);
                    if (!stdout) return callback(new Error('Unable to establish the current docker0 interface IP address.'));
                    return callback(null, stdout);
                });
            },
            (ip, callback) => {
                const config = this.raw();
                config.docker.interface = ip.replace(/(\n|\r)+$/, '');
                Fs.writeJson('./config/core.json', config, callback);
            },
        ], next);
    }

}

module.exports = Config;
