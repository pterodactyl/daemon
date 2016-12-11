# Changelog
This file is a running track of new features and fixes to each version of the daemon released starting with `v0.2.0`.

## v0.3.5 (Barefoot Barbosania)
### Fixed
* Fixes some race conditions and random bugs that would occur when attempting to create a server on the system.
* Fixes a flaw in underlying docker/dockerode implementation that would return a `container not found` error if there was an execution error in the container. Changes `err.statusCode` checks to simply read the response message and look for `No such container:` in the message instead. 


## v0.3.4 (Barefoot Barbosania)
### Added
* Added configurable docker policies to allow for more lax security settings if needed. The full list of policies can be found [in our documentation](https://daemon.pterodactyl.io/docs/security-policies).
* Added `PATCH /config` route to allow panel to tweak core configuration file.

### Changed
* Changes the way that server creation is handled to allow initialization of the `Server()` class without a docker container existing on the system. *This change
causes the application startup to take longer if containers are missing for servers, as we hold application boot until all containers are created now.*
* Better file upload error handling, stops file upload if maximum size is exceeded rather than uploading to maximum size.

### Fixed
* Fixes a race condition when updating a server that would fail to assign the correct memory limits to a container.
* Fixes an issue where file decompression would be extremely slow on large files, and might never occur.
* Fixes mislabeled TeamSpeak 3 in configuration preventing proper boot sequence.

### Deprecated
* `uploads.maxFileSize` removed in favor of `uploads.size_limit` which accepts a size in MB rather than bytes.

## v0.3.3 (Barefoot Barbosania)
### Added
* Daemon now checks if it is up-to-date when booting.

### Fixed
* Fixes hardcoded path for SFTP containers that was causing a whole host of issues on some systems.
* Fixes previously known issue where decompressing large files through the file manager throws a `EMFILE: too many open files` error.
* Fixes permissions and error response for URLs.

### Changed
* Updates dependencies across the platform.
* Docker containers are now named with the template `<sftp username>:<randomstring:3>` for easier identification when running `docker ps (-a)`.
* Changes to deletion and creation function to run certain aspects in parallel to increase speed by utilizing `Async.auto()`. Most notable in the delete function.
* Compression and Decompression now use native `tar` and `unzip` modules to reduce memory footprint and keep things speedy.
* Chown function now uses native module for speed and reliability purposes.
* Startup function modified to run more processes in parallel where possible to cut down on startup time.

### Deprecated
* Daemon now requires Nodejs `v6` or `v7` to run. Previous versions are no longer supported.
* Daemon no longer supports Windows ecosystems due to changes in chown and compression functions.

## v0.3.2 (Barefoot Barbosania)

### Fixed
* Fixes bug where Bungeecord and Spigot could not make use of certain features due to security restrictions. This release removes the `noexec` flag from the `/tmp` directory.
* Fixes bug where daemon would report an extraneous error when starting a container marked for rebuild.
* Fixes bug in certain file parsers that prevented the proper functioning of the parser.

## v0.3.1 (Barefoot Barbosania)

### Added
* Support for `*` node in  config file search, as well as support for search and replace in config values. _Only applies to `yaml` and `json` parsers._
* Calling base route now returns system information for authenticated admins using the global token.

### Changed
* Services now properly extend the `Core` class so that you only need to add functions and extend `parent()` if something is being done differently.
* Changed `{{ build.<options> }}` replacements in service configurations to use `server.` or `config.` starts to identify values that should be replaced. **This is a breaking change from `0.3.0` ONLY if you are using custom templates.**

### Fixed
* Fixes a fatal error that was thrown when rebooting servers at times even though there was no actual server error.
* Fixes a bug with the docker gateway being assigned with a subnet when it should not.
* Fixes a bug that didn't detected bungeecord server's first startup, preventing the correct allocation binding. _Bungeecord servers **cannot run** on `:25577` without triggering this reboot line, apologies in advance._

## v0.3.0 (Barefoot Barbosania)

🎉🎉

### Added
* Added method to handle assigning a percent extra memory to containers based on the current allocated. Should help with Minecraft servers hitting OOM when java attempts to allocate a bit over the hard limit.
* Support for ARK Servers.
* Switched to using a pure Socket.io stream to handle file uploads from the browser. Faster, and much less buggy.
* Added support for file copying.
* Added support for creating empty folders though the API.

### Changed
* Changed some docker container creation options to prevent fork-bombing as well as prevent additional routes for privilege escalation in containers.
* Changed server startup async pathway to call `onStarting` not `onStart`. `onStart` is now called when server is marked as started.
* Daemon now uses internal Docker API to determine the container interface to use. Better support for non-linux environments.
* Fallback to `minecraftping` method for all Minecraft servers to mitigate some Gamedig issues.
* Dependencies are now hard-coded to prevent potential issues with the panel or version changes breaking features.
* Servers now report core stats when starting and wait for performing query.
* Query failures no longer spam log, and can be configured to kill servers after a set number of
consecutive failures (or just keep on trucking).
* Daemon now defaults to checking for updated docker images unless specifically configured otherwise.
* **The following API Endpoints have been modified**:
  * `GET /server/file/<file path>` -> `GET /server/file/f/<file path>`
  * `POST /server/file/<file path>` -> `POST /server/file/save` with `path`: `/path/to/saveas.txt` and `contents`: `file contents`
  * `DELETE /server/file/<file path>` -> `DELETE /server/file/f/<file path>`
  * `GET /server/download/<token>` -> `GET /server/file/download/<token>`

### Fixed
* Properly call `onStop`, `onStarting`, and `onStart` when server actions occur.
* Files with spaces in their name would break the `path()` function, this has been fixed.
* Timezone was improperly set inside server containers.

### Known Issues
* Decompressing large files through the file manager throws a `EMFILE: too many open files` error.

### Removed
* BinaryJS has been removed due to it being abandoned and buggy.

## v0.3.0-rc.2

### Fixed
* Remove PID limit that broke literally every Minecraft server with an "unrelated" error. Sorry about that...

## v0.3.0-rc.1
**Known Issue**: Decompressing large files through the file manager throws a `EMFILE: too many open files` error.

### Added
* Added method to handle assigning a percent extra memory to containers based on the current allocated. Should help with Minecraft servers hitting OOM when java attempts to allocate a bit over the hard limit.
* Support for ARK Servers.

### Changed
* Changed some docker container creation options to prevent fork-bombing as well as prevent additional routes for privilege escalation in containers.
* Changed server startup async pathway to call `onStarting` not `onStart`. `onStart` is now called when server is marked as started.

### Fixed
* Properly call `onStop`, `onStarting`, and `onStart` when server actions occur.
* Fix decompressing files setting the wrong permissions on extractions.

## v0.3.0-pre.3

### Added
* Switched to using a pure Socket.io stream to handle file uploads from the browser. Faster, and much less buggy.

### Changed
* Daemon now uses internal Docker API to determine the container interface to use. Better support for non-linux environments.
* Fallback to `minecraftping` method for all Minecraft servers to mitigate some Gamedig issues.

### Fixed
* Chown function was checking paths incorrectly which could lead to issues if a safe path is already passed (redundant pathing basically, not a security risk, jut causes a File not Found error).
* Files with spaces in their name would break the `path()` function, this has been fixed.
* Timezone was improperly set inside server containers.

### Removed
* BinaryJS has been removed due to it being abandoned and buggy.

## v0.3.0-pre.2

### Changed
* Dependencies are now hard-coded to prevent potential issues with the panel or version changes breaking features.

### Fixed
* Fixed bug preventing copy, rename, move of arrays of files.
* Fixed chown bug preventing files from being owned by the container running the server.

### Added
* Added support for file copying.
* Added support for creating empty folders though the API.


## v0.3.0-pre.1

### Changed
* Servers now report core stats when starting and wait for performing query.
* Query failures no longer spam log, and can be configured to kill servers after a set number of
consecutive failures (or just keep on trucking).
* Daemon now defaults to checking for updated docker images unless specifically configured otherwise.
* **The following API Endpoints have been modified**:
  * `GET /server/file/<file path>` -> `GET /server/file/f/<file path>`
  * `POST /server/file/<file path>` -> `POST /server/file/save` with `path`: `/path/to/saveas.txt` and `contents`: `file contents`
  * `DELETE /server/file/<file path>` -> `DELETE /server/file/f/<file path>`
  * `GET /server/download/<token>` -> `GET /server/file/download/<token>`

## v0.2.1

### New Features
* Configurable DNS servers in core configuration for docker containers.
* Bungeecord containers no longer spam up the console with ping information.

### Bug Fixes
* If an environment variable is set to null don't even send it to the docker container. Fixes unset variable check bug for Spigot building.
* Fixed startup sequence to actually mark status as starting as well as prevent querying server until completely started.

### Security
* Root filesystem in containers is now entirely read-only. Container applications can only write to `/home/container` and `/tmp`.
* Prevent logging server output through docker logging methods. Fixes a potential DoS attack vector (and also saves space).
* Drops the following capabilities from containers: `setpcap`, `mknod`, `audit_write`, `chown`, `net_raw`, `dac_override`, `fowner`, `fsetid`, `kill`, `setgid`, `setuid`, `net_bind_service`, `sys_chroot`, `setfcap` in addition to default dropped capabilities.
* Containers are now in isolated networks and unable to directly connect to a container's specific IP address. The daemon will automatically create this network interface on boot.

## v0.2.0
Requires `Panel@0.4.0`

### New Features
* Server Suspension, immediately stops running processes and blocks SFTP and API access.
* Automatic SFTP Container deployment when process is stated (previously required you manually add a container)
* Updating a server's memory, swap, block io, or cpu quota no longer requires a container rebuild and will take effect immediately.
* Better handling of preflight files. Allows using four different systems for parsing with find and replace capabilities (file, properties, ini, and yaml).

### Bug Fixes
* Fixes bug that would display improper newlines with console data. Allows control characters and ANSI color codes to travel through.

### General
* Updated ESLinter and with that updated code to reflect new standards for ES6
* Code Cleanup and more use of `lodash` module in place of `typeof` checks
