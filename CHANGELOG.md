# Changelog
This file is a running track of new features and fixes to each version of the daemon released starting with `v0.2.0`.

## v0.2.0 (release scheduled ~ Mid September)
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
