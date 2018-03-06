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
const Fs = require('fs-extra');
const _ = require('lodash');
const extendify = require('extendify');
const Cache = require('memory-cache');

class Config {
    constructor() {
        if (_.isNull(Cache.get('config'))) {
            Cache.put('config', this.raw());
        }
    }

    raw() {
        try {
            return rfr('config/core.json');
        } catch (ex) {
            if (ex.code === 'MODULE_NOT_FOUND') {
                console.error('+ ------------------------------------ +'); // eslint-disable-line
                console.error('|  No config file located for Daemon!  |'); // eslint-disable-line
                console.error('|  Please create a configuration file  |'); // eslint-disable-line
                console.error('|  at config/core.json with the info   |'); // eslint-disable-line
                console.error('|  provided by Pterodactyl Panel when  |'); // eslint-disable-line
                console.error('|  you created this node.              |'); // eslint-disable-line
                console.error('+ ------------------------------------ +'); // eslint-disable-line
                console.trace(ex.message); // eslint-disable-line
                process.exit(1);
            }
            throw ex;
        }
    }

    get(key, defaultResponse) {
        let getObject;
        try {
            getObject = _.reduce(_.split(key, '.'), (o, i) => o[i], Cache.get('config'));
        } catch (ex) { _.noop(); }

        if (!_.isUndefined(getObject)) {
            return getObject;
        }

        return (!_.isUndefined(defaultResponse)) ? defaultResponse : undefined;
    }

    save(json, next) {
        if (!json || !_.isObject(json) || _.isNull(json) || !_.keys(json).length) {
            throw new Error('Invalid JSON was passed to Builder.');
        }

        Fs.writeJson('./config/core.json', json, { spaces: 2 }, err => {
            if (!err) Cache.put('config', json);
            return next(err);
        });
    }

    modify(object, next) {
        if (!_.isObject(object)) return next(new Error('Function expects an object to be passed.'));

        const deepExtend = extendify({
            inPlace: false,
            arrays: 'replace',
        });
        const modifiedJson = deepExtend(Cache.get('config'), object);

        Fs.writeJson('./config/core.json', modifiedJson, { spaces: 2 }, err => {
            if (err) return next(err);

            Cache.put('config', modifiedJson);
            return next();
        });
    }
}

module.exports = Config;
