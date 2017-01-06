const _ = require('lodash');
const inquirer = require('inquirer');
//const request = require('request');
const url = require('url');

const argv = require('yargs')
    .usage('npm run configure -- <arguments>')
    .describe('p', 'The url to the panel the node should be added to')
    .alias('p', 'panel-url')
    .describe('n', 'The name of the node to configure')
    .alias('n', 'node-name')
    .describe('t', 'An API token to use. Allows to skip login')
    .alias('t', 'api-token')
    .describe('u', 'An admin username to login with. Avoids API token use')
    .alias('u', 'username')
    .describe('password', 'An admin password to login with. Not recommended, use a token or interactive login')
    .describe('h', 'Show this help')
    .alias('h', 'help')
    .help('h')
    .argv;

const options = {
    panelurl: argv.p,
    nodename: argv.n,
    token: argv.t,
    username: argv.u,
    password: argv.password,
};

inquirer.prompt([
    {
        name: 'panelurl',
        type: 'string',
        message: 'Url of the panel to add the node to:',
        when: () => _.isUndefined(options.panelurl),
        validate: input => (input === '' ? 'The panel url is required' : true),
        format: input => url.format(url.parse(input)),
    },
    {
        name: 'nodename',
        type: 'string',
        message: 'Name of the node to configure:',
        when: () => _.isUndefined(options.nodename),
        validate: input => (input === '' ? 'The node name is required' : true),
    },
    {
        name: 'token',
        type: 'string',
        message: 'An API Token to use (Enter nothing to use login with username and password instead):',
        default: '',
        when: () => _.isUndefined(options.token) && _.isUndefined(options.username),
    },
    {
        name: 'username',
        type: 'string',
        message: 'An admin username:',
        when: answers => _.isUndefined(options.token) && answers.token === '' && _.isUndefined(options.username),
        validate: input => (input === '' ? 'Either a token or a user is required' : true),
    },
    {
        name: 'password',
        type: 'password',
        message: 'Password:',
        when: answers => _.isUndefined(options.password) && (_.isString(options.username) || _.isString(answers.username)),
        validate: input => (input === '' ? 'A password is required' : true),
    },
]).then(answers => {
    _.forEach(answers, (answer, key) => {
        options[key] = answer;
    });

    console.log(options);

    // TODO actualy configure stuff.
});
