# Pterodactyl Daemon (Wings)
The server control and management daemon built specifically for Pterodactyl Panel.

# Contributing
Please see `CONTRIBUTING.md` for information needed if you want to contribute to this project.

# Running Developmental Builds

## Building Project
In order to run a development build of the daemon you will need to first build the project using Babel. This can be easily accomplished using the commands below.

```
npm install
npm run build
npm start
```

This will compile the code in `src/` using Babel and send the output to `lib/`. If you make any changes to the code in `src/` you will need to rebuild before running to have those changes take effect.

## Building Executable
It is possible to ship the daemon as an executable file. To do this, you will need to make use of `nexe` which is packaged and included with this program. You should run this after running `npm run build` since we are using the built files to compile the program.

```
node_modules/nexe/bin/nexe -i lib/*.js package.json -o daemon -r 4.2.3
```

This will output a file called `daemon` which can be run using `./daemon` in that directory. In order to have cleaner output, you will need to pass the output to `bunyan`, using `./daemon | node_modules/bunyan/bin/bunyan -o short`

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
      "socket": "/var/run/docker.sock"
    },
    "sftp": {
        "path": "/srv/data",
        "port": 2022,
        "container": "10ada0566a18"
    },
    "logPath": "logs/",
    "keys": [
      "9b6c1fa5-fa5f-49f4-970e-bf2bb28272b0"
    ]
}
```
