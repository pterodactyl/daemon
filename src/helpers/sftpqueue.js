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

const _ = require('lodash');

class SFTPQueue {
    constructor() {
        this.tasks = {};
        this.handlers = {};
    }

    push(location, task) {
        if (this.handlers[location]) {
            if (!_.isArray(this.tasks[location])) {
                this.tasks[location] = [];
            }

            this.tasks[location].push(task);
        } else {
            this.handleTask(location, task);
        }
    }

    handleTask(location, task) {
        this.handlers[location] = true;

        task(() => {
            if (_.isArray(this.tasks[location]) && this.tasks[location].length > 0) {
                this.handleTask(location, this.tasks[location].shift());
            } else {
                this.handlers[location] = false;
            }
        });
    }

    clean() {
        this.tasks = {};
        this.handlers = {};
    }
}

module.exports = SFTPQueue;
