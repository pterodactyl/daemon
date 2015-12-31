'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const _ = require('underscore');
const Path = require('path');
const Async = require('async');
const Fs = require('fs-extra');

const ExtendedMixin = rfr('src/helpers/deepextend.js');
const ConfigHelper = rfr('src/helpers/config.js');
const Status = rfr('src/helpers/status.js');

const Config = new ConfigHelper();

_.mixin({ 'deepExtend': ExtendedMixin });

class Core {
    constructor(server, config) {
        const self = this;
        this.server = server;
        this.json = server.json;
        this.option = this.json.service.option;
        this.object = undefined;

        // Find our data on initialization.
        _.each(config, function coreOnConstructorLoop(element) {
            if (self.option.match(element.tag)) {
                // Handle "symlink" in the configuration for plugins...
                self.object = element;
                if (typeof element.symlink !== 'undefined' && typeof config[element.symlink] !== 'undefined') {
                    self.object = _.deepExtend(config[element.symlink], element);
                }
            }
        });
    }

    // Forgive me padrè for I have sinned. Badly.
    //
    // This is some incredibly messy code. As best I can describe, it
    // loop through each listed config file, and then uses regex to search
    // and replace values with values from the config file.
    //
    // This is all done with parallel functions, so every listed file
    // is opened, and then all of the lines are run at the same time.
    // Very quick function, surprisingly...
    onPreflight(next) {
        const self = this;
        const parsedLines = [];
        // Check each configuration file and set variables as needed.
        Async.forEachOf(this.object.configs, function coreOnPreflightFileLoop(searches, file, callback) {
            // Read the file that we have looped to.
            Fs.readFile(self.server.path(file), function (err, data) {
                if (err) {
                    // File doesn't exist
                    // @TODO: handle restarting the server to see if the file appears
                    // at which point we can write to it.
                    if (err.message.toString().indexOf('ENOENT: no such file or directory') > -1) {
                        return callback();
                    }
                    return callback(err);
                }
                // Loop through each line and set the new value if necessary.
                parsedLines[file] = data.toString().split('\n');
                Async.forEachOf(parsedLines[file], function (line, index, eachCallback) {
                    // Check line aganist each possible search/replace set in the config array.
                    Async.forEachOf(searches, function (replaceString, find, searchCallback) {
                        // Positive Match
                        if (line.startsWith(find)) {
                            // Set the new line value.
                            const newLineValue = replaceString.replace(/{{ (\S+) }}/g, function ($0, $1) {
                                return ($1).split('.').reduce((o, i) => o[i], self.json);
                            });
                            parsedLines[file][index] = newLineValue;
                        }
                        searchCallback();
                    }, function () {
                        eachCallback();
                    });
                }, function () {
                    Fs.writeFile(self.server.path(file), parsedLines[file].join('\n'), function (writeErr) {
                        return callback(writeErr);
                    });
                });
            });
        }, function (err) {
            return next(err);
        });
    }

    onStart(next) {
        return next();
    }

    onConsole(data) {
        const self = this;
        // Started
        if (data.indexOf(this.object.startup.done) > -1) {
            self.server.setStatus(Status.ON);
        }

        // Stopped; Don't trigger crash
        if (this.server.status !== Status.ON && typeof this.object.startup.userInteraction !== 'undefined') {
            Async.each(this.object.startup.userInteraction, function coreOnConsoleAsyncEach(string) {
                if (data.indexOf(string) > -1) {
                    self.server.log.info('Server detected as requiring user interaction, stopping now.');
                    self.server.setStatus(Status.STOPPING);
                }
            });
        }

        this.server.emit('console', this.sanitizeSocketData(data));
    }

    onStop(next) {
        return next();
    }

    sanitizeSocketData(data) {
        return data.replace(new RegExp(this.object.output.find || '\r\n', this.object.output.flags || 'g'), this.object.output.replace || '');
    }
}

module.exports = Core;
