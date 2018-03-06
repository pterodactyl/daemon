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
const Fs = require('fs-extra');

const ConfigHelper = rfr('src/helpers/config.js');
const Config = new ConfigHelper();

class TimezoneHelper {
    configure(next) {
        if (Config.get('docker.timezone_path', false) !== false) {
            return next();
        }

        Async.parallel({
            is_timezone: callback => {
                Fs.access('/etc/timezone', (Fs.constants || Fs).F_OK, err => {
                    callback(null, (!err));
                });
            },
            is_localtime: callback => {
                Fs.access('/etc/localtime', (Fs.constants || Fs).F_OK, err => {
                    callback(null, (!err));
                });
            },
        }, (err, results) => {
            if (err) return next(err);

            if (!results.is_timezone && !results.is_localtime) {
                return next(new Error('No suitable timezone file was located on the system.'));
            }

            if (results.is_timezone) {
                Config.modify({ docker: { timezone_path: '/etc/timezone' } }, next);
            } else {
                Config.modify({ docker: { timezone_path: '/etc/localtime' } }, next);
            }
        });
    }
}

module.exports = TimezoneHelper;
