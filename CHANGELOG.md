# Changelog
This file is a running track of new features and fixes to each version of the daemon released starting with `v0.2.0`.

## v0.5.0-rc.1 (Dazzling Daohugoupterus)
### Fixed
* Fixes a bug that would prevent daemon boot if a docker image was missing and assigned to a server that needed to be rebuilt.
* Fixes a bug prevent server installation when no script is defined.
* Fixes bug causing packs to fail installation due to an unpacking issue.
* Fixes support for symlinked files in the file manager and returns the proper mime type for them.
* `[beta.6]` — Fixes bug when creating a user on CentOS.
* `[beta.6]` — Fixes a bug with Cyberduck where files could not be overwritten.
* Fixes 404 error that would arise from bad symlinks in the server data directory.

### Added
* Adds support for Docker Weave setups.
* Adds support for parsing files using XML format.
* Server boot process now sets the correct ownership on files when the server is booted.
* Files uploaded via SFTP are now blocked if there is not enough server space available to store it.

## v0.5.0-beta.5 (Dazzling Daohugoupterus)
### Added
* File parsing now supports `env.VARIABLE` syntax as a shorter alternative to `server.build.env.VARIABLE` for egg configurations.
* Adds support for inter-server private networking via Docker.

### Changed
* Changed container creation logic to ensure that servers with no swap space assigned do not get allocated swap.
* Servers are now killed by default when they run out of disk space rather than being gracefully stopped.

### Removed
* `OOM` exceptions can no longer be disabled in Docker containers due to a startling number of users trying to use this to solve memory issues and causing more problems.

## v0.5.0-beta.4 (Dazzling Daohugoupterus)
### Fixed
* `[beta.3]` — Fixes bug that caused servers to not be able to be reinstalled due to a check for non-existant keys.
* Fixes race condition when attemping to boot a server after a rebuild has begun.

## v0.5.0-beta.3 (Dazzling Daohugoupterus)
### Fixed
* `[beta.2]` — Fixes a bug that caused the Daemon to fail the boot process after upgrading from previous versions due to a missing egg configuration.

## v0.5.0-beta.2 (Dazzling Daohugoupterus)
### Fixed
* `[beta.1]` — Fixes a bug causing the migration utility to not run correctly due to globbing.
* `[beta.1]` — Fixes missing route causing inability to revoke an access token manually.
* `[beta.1]` — Fixes errors causing inability to create servers on the Panel.

### Changed
* `[beta.1]` — Data migration is not optional, update code to reflect such.

## v0.5.0-beta.1 (Dazzling Daohugoupterus)
### Added
* Added more data integrity checks when running a server. These changes make it impossible to boot a server that has an invalid service option configuration.
* SFTP is now handled internally within the Daemon rather than relying on a Docker SFTP container. Authentication is performed using a Panel user.

### Fixed
* Fixes `Cannot get length of undefined` errors that would occasionally plauge certain servers on the daemon.
* Fixes `write after end` error caused by race condition.
* Fixes error caused by missing per cpu usage data.
* Servers referencing a missing or empty configuration file will now still boot but be inoperable via the console.
* Fixes a bug where times returned by file listing API endpoint were incorrect.

### Changed
* Authentication now uses dynamically changing tokens issued by the Panel.
* All API routes now prefixed with `v1/`.
* Service options now use the new panel structure and are stored in `src/services/configs/<uuid>.json`. All existing servers will need to be updated, the panel ships with a command to do this.
* Rebuilding a server now allows the service to be changed on the fly and re-applied.
* Server data is now stored in `/srv/daemon-data/<uuid>` rather than `/srv/daemon-data/<username>/data` by default.

## v0.4.5 (Candid Comodactylus)
### Fixed
* Fixes a bug that caused newly created nodes to fail during the server creation process due to a missing timezone file location in the configuration. [`#593`](https://github.com/Pterodactyl/Panel/issues/593)
* Fixes an error thrown when deleting a file via the API. [`#587`](https://github.com/Pterodactyl/Panel/issues/587)

## v0.4.4 (Candid Comodactylus)
### Fixed
* Fixes a bug with certain NGINX configurations that would cause a 404 error when attempting to access a service's configuration files.
* Should fix a bug causing servers to not be created correctly on first daemon boot due to a missing SFTP docker container.

### Added
* Adds support for deleting multiple files at once via the API. This currently is not used by anything, but paves a path for a future panel update.
* Adds support for `yarn` package installer, but does not require this installation method.
* Added more verbose error logging when there is an issue connecting to the panel to help with debugging issues.
* Added support for Nodejs `v8`

### Changed
* Cleaned up boot order to be more logical and output information in the correct order.
* Added a cleaner error message if docker does not appear to be running rather than a confusing stack trace.
* Updated multiple dependencies to the latest version.

## v0.4.3 (Candid Comodactylus)
### Fixed
* Fixes a bug that would throw a `setStatus` undefined error when deleting a failed install server.
* Fixes bug in private registry verification function that wasn't using authentication correctly on wildcards.

### Changed
* Updated Socket.io to v2.0.3, will require `Panel@0.6.4` as a minimum supported version to work correctly.
* Updated dependencies to latest versions as well as verified support for Nodejs v8.

## v0.4.2 (Candid Comodactylus)
### Fixed
* Fixes security hole which set the active socket permissions to the last user to request the socket, potentially allowing users without permissions to access different console options.

## v0.4.1 (Candid Comodactylus)
### Fixed
* Fixed bug causing `undefined startup` when using an invalid service tag, or general loading issues.
* Fixes potential race condition when booting daemon that would lead to services being incomplete when attemting to load all data.
* Fixes installation process hanging when no script is defined for a service option.

### Changed
* Cleaner handling of errors when attemping to create a new server. If an error occurs the daemon will self-clean and remove the broken server.

## v0.4.0 (Candid Comodactylus)
### Fixed
* Fixes a race condition that would cause duplicate socket streams for data output and generally confuse both the panel and daemon.
* Fixes a race condition when booting SFTP subsystem container.
* `socketio-file-upload` bumped to `0.6.0` in order to address a potential issue in file uploads in Chrome.
* Fixes potential bug with CPU math if no object is defined.
* Fixes bug with test suite due to missing eslint rule.
* Fixes crash that might occur if a server fails to install a docker container and is then deleted.
* Fixes issue with private docker registries being applied to all images on the system when pulling.

### Changed
* Minor version updates to multiple dependencies (no change in daemon function).
* SFTP subsystem now looking for container based on assigned ID and if a container is not found it will also attempt to locate it by image name before trying to create a new container.
* Updated dependencies to latest versions.
* Docker containers are now named after the SFTP username to ease finding those servers in the listing.
* Provide cleaner errors when a server is not found on the system. Return `HTTP/404` if server is missing, and `HTTP/400` if the headrs are invalid.
* Use `/daemon` for all calls to the panel, rather than `/remote`.

### Added
* Service configuration files are now retrieved from the panel the daemon is associated with rather than being locally managed. Any changes are automatically pulled on daemon boot.
* Daemon configuration is now possible using `npm run-script configure` to contact remote panel and collect the configuration file.
* Support for sending commands and receiving server log over websockets.
* Servers can now auto-start on completion of the install process.
* Errors encountered when parsing files during pre-flight are now thrown to the console websocket to be displated to users.
* Server status changes are now displayed in the console stream, as well as clearer docker connection updates.
* Support for running service scripts when installing a server for the first time.
* Support for reinstalling a server with a given service and option configuration.
* Ability to use the `host` network stack if needed. Allows containers to access resources on `127.0.0.1` without having to do any routing. _This option should only be used in private environments as it allows a container access to the host network stack._
* Support for working disk limits that pevent server booting, and stop a server automatically if it is found to be violating limits.

### Removed
* Gamedig removed due to lack of updates and multiple security vulnerabilities in dependencies.
* Removed unused `is-json` dependency.

## v0.4.0-rc.1
### Added
* Support for running service scripts when installing a server for the first time.
* Support for reinstalling a server with a given service and option configuration.
* Ability to use the `host` network stack if needed. Allows containers to access resources on `127.0.0.1` without having to do any routing. _This option should only be used in private environments as it allows a container access to the host network stack._
* Support for working disk limits that pevent server booting, and stop a server automatically if it is found to be violating limits.

### Changed
* Use `/daemon` for all calls to the panel, rather than `/remote`.

## v0.4.0-beta.1.1
### Changed
* Provide cleaner errors when a server is not found on the system. Return `HTTP/404` if server is missing, and `HTTP/400` if the headrs are invalid.

## v0.4.0-beta.1
### Fixes
* Fixes issue with private docker registries being applied to all images on the system when pulling.
* `[pre.3]` — Failed pack downloads/installs no longer cause the server to throw an error and fail installation.

### Changed
* Docker containers are now named after the SFTP username to ease finding those servers in the listing.

### Added
* Servers can now auto-start on completion of the install process.
* Errors encountered when parsing files during pre-flight are now thrown to the console websocket to be displated to users.
* Server status changes are now displayed in the console stream, as well as clearer docker connection updates.

## v0.4.0-pre.3
### Fixed
* `[pre.2]` — Fixes broken regex not detecting missing spaces in file parser text replacements.
* `[pre.2]` — Address bug preventing editing of files via file manager in panel.

### Changed
* `[pre.2]` — Re-adds `mmmagic` dependency to address issues with file manager.

## v0.4.0-pre.2
### Changed
* Updated dependencies to latest versions.
* `[pre.1]` — Server boot now checks if service files exist for the server and if not throws a fatal error.
* `[pre.1]` — Packs are now deleted if the hashes are different and a new one is being downloaded.

### Fixed
* Fixes potential bug with CPU math if no object is defined.
* Fixes bug with test suite due to missing eslint rule.
* Fixes crash that might occur if a server fails to install a docker container and is then deleted.

### Removed
* Removes `mmmagic` dependency in favor of just checking the file extension as any potential mime bypassing is mitigated by low-level processes.

## v0.4.0-pre.1
### Added
* Service configuration files are now retrieved from the panel the daemon is associated with rather than being locally managed. Any changes are automatically pulled on daemon boot.
* Daemon configuration is now possible using `npm run-script configure` to contact remote panel and collect the configuration file.
* Support for sending commands and receiving server log over websockets.

### Changed
* `socket.io` bumped to `1.7.2`
* `socketio-file-upload` bumped to `0.6.0` in order to address a potential issue in file uploads in Chrome.
* Minor version updates to multiple dependencies (no change in daemon function).
* SFTP subsystem now looking for container based on assigned ID and if a container is not found it will also attempt to locate it by image name before trying to create a new container.

### Fixed
* Fixes a race condition that would cause duplicate socket streams for data output and generally confuse both the panel and daemon.
* Fixes a race condition when booting SFTP subsystem container.

### Removed
* Gamedig removed due to lac of updates and multiple security vulnerabilities in dependencies.
* Removed unused `is-json` dependency.

## v0.3.7 (Barefoot Barbosania)
### Fixed
* Fixes a network configuration issue with `Docker 1.12.4` caused by no assigned IPv6 gateway.

### Changed
* ICC is now **enabled** by default on `pterodactyl0`.

### Added
* Additional network configuration options are available in core.json if needed to customize network name and subnets.
* Added support for pulling images from private registries.


## v0.3.6 (Barefoot Barbosania)
### Fixed
* Fixes runtime bug that broke socket connections on newly created servers until the daemon was restarted. This was most obvious if you created a new server and then started it and reloaded the page. Due to a modification in the build script the server was improperly initialized and requests would get sucked into the wrong portals.

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
