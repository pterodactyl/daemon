#!/bin/ash
set -e

if [[ ! -z "$PANEL_URL" && ! -z "$TOKEN" ]]; then
    echo "Configuring Pterodactyl Daemon container"
    echo "Setting up Node remote connection"
    npm run configure -- -p $PANEL_URL -t $TOKEN

    if [ ! -S "/var/run/docker.sock" ]; then
        echo "Docker daemon not found !"
        exit 1
    fi
    echo "Configuration is done."
fi

exec "$@"
