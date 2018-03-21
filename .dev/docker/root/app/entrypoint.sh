#!/bin/ash
set -e

# Check if default command is used
if [ "$1" = "/usr/bin/npm" ]; then
    if [[ ! -z "$PANEL_URL" && ! -z "$TOKEN" ]]; then
        echo "Configuring Pterodactyl Daemon container"
        echo "Setting up Node remote connection"
        npm run configure -- -p $PANEL_URL -t $TOKEN

        if [ ! -S "/var/run/docker.sock" ]; then
            echo "Docker daemon not found !"
            exit 1
        fi
        echo "Configuration is done."
    else
        echo "Configuration failed, PANEL_URL and/or TOKEN missing from env."
        exit 1
    fi
fi

exec "$@"
