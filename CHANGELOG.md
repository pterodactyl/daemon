# Changelog
This file is a running track of new features and fixes to each version of the daemon released starting with `v0.2.0`.

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
