const _ = require('lodash');
const inquirer = require('inquirer');

const argv = require('yargs')
  .usage('npm run configure -- <arguments>')
  .describe('n', 'The name of the node to configure')
  .alias('n', 'node-name')
  .describe('t', 'An API token to use. Allows to skip login')
  .alias('t', 'api-token')
  .describe('u', 'An admin username to login with. Avoids API token use')
  .alias('u', 'username')
  .describe('p', 'An admin password to login with. Not recommended, use a token or interactive login')
  .alias('p', 'password')
  .describe('h', 'Show this help')
  .alias('h', 'help')
  .help('h')
  .argv;

const options = {
    nodename: argv.n,
    token: argv.t,
    username: argv.u,
    password: argv.p,
};

inquirer.prompt([
    {
        name: 'nodename',
        type: 'string',
        message: 'The name of the node to configure:',
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
        validate: input => (input === '' ? 'Either a token or a user is required!' : true),
    },
    {
        name: 'password',
        type: 'password',
        message: 'Password:',
        when: answers => _.isString(options.username) || _.isString(answers.username),
        validate: input => (input === '' ? 'A password is required' : true),
    },
]).then(answers => {
    _.forEach(answers, (answer, key) => {
        options[key] = answer;
    });

    console.log(options);

    // TODO actualy configure stuff.
});
