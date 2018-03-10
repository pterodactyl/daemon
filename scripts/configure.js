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

/* eslint no-console: 0 */
const _ = require('lodash');
const Inquirer = require('inquirer');
const Request = require('request');
const Fs = require('fs-extra');
const Path = require('path');

const CONFIG_PATH = Path.resolve('config/core.json');
const CONFIG_EXISTS = Fs.existsSync(CONFIG_PATH);

const regex = {
    fqdn: new RegExp(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,64}\/?$/),
    ipv4: new RegExp(/^(?:https?:\/\/)?(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\.|\/?$)){4}/),
};

const params = {
    panelurl: {
        name: 'Panel url',
        cmdoption: 'p',
        validate: value => {
            if (value === '') {
                return 'The panel url is required';
            }
            if (!value.match(regex.fqdn) && !value.match(regex.ipv4)) {
                return 'Please provide either a URL (with protocol) or an IPv4 address.';
            }
            return true;
        },
    },
    token: {
        name: 'Configuration token',
        cmdoption: 't',
        validate: value => {
            if (value === '') {
                return 'A configuration token is required.';
            }
            if (value.length === 32) {
                return true;
            }
            return 'The token provided is invalid. It must be 32 characters long.';
        },
    },
    overwrite: {
        name: 'Overwrite',
        cmdoption: 'c',
    },
};

/**
 * yargs compatible method for validating the arguments
 */
function checkParams(arg) {
    _.forEach(params, param => {
        if (_.has(arg, param.cmdoption)) {
            const valResult = param.validate(arg[param.cmdoption]);
            if (valResult !== true) {
                throw new Error(`${param.name}: ${valResult}`);
            }
        }
    });
    return true;
}

// Parse provided arguments with yargs for insanly easier usage
const argv = require('yargs')
    .usage('npm run configure -- <arguments>')
    .describe('p', 'The panel url to pull the configuration from')
    .alias('p', 'panel-url')
    .describe('t', 'The configuration token')
    .alias('t', 'token')
    .boolean('o')
    .describe('o', 'Overwrite existing configuration file')
    .alias('o', 'overwrite')
    .alias('h', 'help')
    .check(checkParams)
    .help('h')
    .fail((msg, err, yargs) => {
        console.error(err.message);
        console.log(yargs.help());
        process.exit(1);
    })
    .argv;

// Put the provided values into the overly complicated params object
_.forEach(params, (param, key) => {
    if (_.has(argv, param.cmdoption)) {
        params[key].value = argv[param.cmdoption];
    }
});

// Check if the configuration file exists already
if (CONFIG_EXISTS) console.log('Configuration file (core.json) exists.');

// Interactive questioning of missing parameters
Inquirer.prompt([
    {
        name: 'panelurl',
        type: 'string',
        message: 'Url of the panel to add the node to:',
        when: () => _.isUndefined(params.panelurl.value),
        validate: params.panelurl.validate,
    }, {
        name: 'token',
        type: 'string',
        message: 'A configuration token to use:',
        when: () => _.isUndefined(params.token.value),
        validate: params.token.validate,
    }, {
        // Will only be asked if file exists and no overwrite flag is set
        name: 'overwrite',
        type: 'confirm',
        default: false,
        message: 'Overwrite existing configuration?',
        when: () => !params.overwrite.value && CONFIG_EXISTS,
    },
]).then(answers => {
    // Overwrite the values in the overly complicated params object
    _.forEach(answers, (answer, key) => {
        params[key].value = answer;
    });

    // If file exists and no overwrite wanted error and exit.
    if (!params.overwrite.value && CONFIG_EXISTS) {
        console.error('Configuration file already exists, no overwrite requested. Aborting.');
        process.exit();
    }

    // Fetch configuration from the panel
    console.log('Fetching configuration from panel.');
    Request.get(`${params.panelurl.value}/daemon/configure/${params.token.value}`, (error, response, body) => {
        if (!error) {
            // response should always be JSON
            const jsonBody = JSON.parse(body);

            if (response.statusCode === 200) {
                console.log('Writing configuration to file.');

                Fs.writeFile(CONFIG_PATH, JSON.stringify(jsonBody, null, 4), err => {
                    if (err) {
                        console.error('Failed to write configuration file.');
                    } else {
                        console.log('Configuration file written successfully.');
                    }
                });
            } else if (response.statusCode === 403) {
                if (_.get(jsonBody, 'error') === 'token_invalid') {
                    console.error('The token you used is invalid.');
                } else if (_.get(jsonBody, 'error') === 'token_expired') {
                    console.error('The token provided is expired.');
                } else {
                    console.error('An unknown error occured!', body);
                }
            } else {
                console.error('Sorry. Something went wrong fetching the configuration.');
            }
        } else {
            console.error('Sorry. Something went wrong fetching the configuration.');
        }
    });
});
