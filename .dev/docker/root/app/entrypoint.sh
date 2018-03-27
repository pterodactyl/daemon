#!/bin/ash
set -e

CONFIG="config/core.json"

# Check if default command is used
if [ "$1" = "/usr/bin/npm" ]; then

    if [ ! -z "$PANEL_URL" ] && [ ! -z "$TOKEN" ]; then
        echo "] Configuring Pterodactyl Daemon container"

        if [ -e $CONFIG ] && [ -z "$OVERWRITE" ]; then
            echo "Configuration file $CONFIG exist and OVERWRITE not set, abording !"
            exit 1
        fi

        npm run configure -- --panel-url="$PANEL_URL" --token="$TOKEN" --overwrite
        chmod 775 $CONFIG

        if [ -S "/var/run/docker.sock" ]; then
            echo "] Docker daemon found !"
        else
            echo "Docker daemon not found !"
            exit 1
        fi
        echo "] Configuration is done."
    fi
fi

exec "$@"
