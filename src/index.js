'use strict';

/**
 * Pterodactyl Daemon
 * Copyright (c) 2015 Dane Everitt <dane@daneeveritt.com>
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
const rfr = require('rfr');
const Log = rfr('src/helpers/logger.js');

Log.info('Starting Pterodactyl Daemon...');

const Async = require('async');
const Initializer = rfr('src/helpers/initialize.js').Initialize;
const SFTPController = rfr('src/controllers/sftp.js');
const Initialize = new Initializer();
const SFTP = new SFTPController();

Async.series([
    function indexAsyncStartSFTP(callback) {
        Log.info('Attempting to start SFTP service container...');
        SFTP.startService(callback);
        Log.info('SFTP service container booted!');
    },
    function indexAsyncInitialize(callback) {
        Log.info('Attempting to load servers and initialize daemon...');
        Initialize.init(callback);
    },
], function indexAsyncCallback(err) {
    if (err) {
        // Log a fatal error and exit.
        // We need this to initialize successfully without any errors.
        Log.fatal(err);
        process.exit(1);
    }
    rfr('src/http/routes.js');
    Log.info('Initialization Successful!');
});

process.on('uncaughtException', function processUncaughtException(err) {
    Log.fatal(err, 'A fatal error occured during an operation.');
});

process.on('SIGUSR2', function processSIGUSR2() {
    Log.reopenFileStreams();
});
