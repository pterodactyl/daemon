const _ = require('lodash');
const inquirer = require('inquirer');
const winston = require('winston');
const request = require('request');
const fs = require('fs');
const path = require('path');

const configFilePath = path.resolve(__dirname, '../config/core.json');

const log = new winston.Logger({
    transports: [new winston.transports.Console({
        level: 'info',
        handleExceptions: true,
        colorize: true,
    })],
});

const regex = {
    fqdn: new RegExp(/^https?:\/\/(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,64}\/?$/),
    ipv4: new RegExp(/((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.|$)){4}/),
};

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
    .help('h').argv;

const params = {
    panelurl: {
        name: 'Panel url',
        value: argv.p,
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
        value: argv.t,
        validate: value => {
            if (value === '') {
                return 'A configuration token is required.';
            }
            if (value.length !== 32) {
                return 'The token provided is invalid. It must be 32 characters long.';
            }
            return true;
        },
    },
    overwrite: {
        name: 'Overwrite',
        value: argv.o,
    },
};

// Validate and filter the provided command line params
function validateParams() {
    _.forEach(params, (option, key) => {
        if (!_.isUndefined(option.value)) {
            if (_.isFunction(option.validate)) {
                const valResult = option.validate(option.value);
                if (valResult !== true) {
                    log.error(`${option.name}: ${valResult}`);
                    params[key].value = undefined;
                    return;
                }
            }
        }
    });
}

function main() {
    const configExists = fs.existsSync(configFilePath);

    if (configExists) log.debug('Config already exists.');

    inquirer.prompt([
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
            name: 'overwrite',
            type: 'confirm',
            default: false,
            message: 'Overwrite existing configuration?',
            when: () => !params.overwrite.value && configExists,
        },
    ]).then(answers => {
        _.forEach(answers, (answer, key) => {
            params[key].value = answer;
        });

        if (!params.overwrite.value && configExists) {
            log.error('Configuration already exists. Aborting.');
            return;
        }

        log.info('Trying to fetch configuration from the panel...');

        request(`${params.panelurl.value}/remote/configuration/${params.token.value}`, (error, response, body) => {
            if (!error) {
                const jsonBody = JSON.parse(body);
                if (response.statusCode === 200) {
                    log.info('Writing configuration file...');

                    fs.writeFile(configFilePath, JSON.stringify(jsonBody, null, 4), err => {
                        if (err) {
                            log.error('Failed to write configuration file.');
                        } else {
                            log.info('Configuration written successfully.');
                        }
                    });
                } else if (response.statusCode === 403) {
                    if (jsonBody.error === 'token_invalid') {
                        log.error('The token you used is invalid.');
                    } else if (jsonBody.error === 'token_expired') {
                        log.error('The token you used is expired.');
                    } else {
                        log.error('An unknown error occured!', body);
                    }
                }
            } else {
                log.error('Sorry. Something went wrong fetching the configuration.');
            }
        });
    });
}

validateParams();
main();
