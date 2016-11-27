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
const _ = require('lodash');
const Async = require('async');

class Pack {
    constructor(server) {
        this.server = server;
        this.pack = this.server.json.service.pack;
    }

    // Called when a server is started and marked as needing a pack update
    // of some sort. Either due to being created, or a button click
    // from the panel or API that asks for an update.
    install(next) {
        if (_.isNil(this.pack) || _.isUndefined(this.pack)) {
            return next();
        }

        Async.series([
            callback => {
                this.checkCache(callback);
            },
        ], next);
    }

    checkCache() {
        // Checks cache; if up-to-date or not due for a check
        // simply return and allow setup to continue.
        //
        // If cache is expired, call updateCache() and then return
        // for install to continue.
    }

    updateCache() {
        // Updates the cache for a given pack. Should check if
        // an update is in progress, and if so wait for an
        // event emitter to be called that will alert
        // to the update status.
        //
        // If no update is in progress, this function should
        // contact the panel and determine if the hash has changed.
        // If not, simply return and tell the checkCache() call that
        // eveything is good. If hash has changed, handle the update.
    }

    getNewPack() {
        // Contacts the panel to get the new pack information
        // and files.
    }
}

module.exports = Pack;
