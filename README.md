# Pterodactyl Daemon (Wings)
The server control and management daemon built specifically for Pterodactyl Panel.

# Contributing
Please see `CONTRIBUTING.md` for information needed if you want to contribute to this project.

# Running Developmental Builds

## Building Project
In order to run a development build of the daemon you will need to first build the project using Babel. This can be easily accomplished using the commands below.

```
npm run-script build
npm start
```

This will compile the code in `src/` using Babel and send the output to `lib/`. If you make any changes to the code in `src/` you will need to rebuild before running to have those changes take effect.

## Building Configuration File
A basic configuration will need to be created in order to run a developmental build.

```
{
    "web": {
        "listen": 8080,
        "ssl": {
            "enabled": false,
            "certificate": "~/.ssl/public.crt",
            "key": "~/.ssl/public.key"
        }
    },
    "docker": {
        "socket": "unix:///var/run/docker.sock"
    },
    "logPath": "logs/"
}
```
