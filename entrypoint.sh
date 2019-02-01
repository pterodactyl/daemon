#!/bin/ash
## Ensure we are in /srv/daemon

cd /srv/daemon

if [ "$GO_SFTP" == "true" ]; then
    if [ grep -o '"enabled": false,' /srv/daemon/config/core.json != '"enabled": false,' ]; then
        echo -i "Updating config"
        # sed -i 's/        "ip": "0.0.0.0",/        "ip": "0.0.0.0",\n        "enabled": false,/g' /srv/daemon/config/core.json
        curl https://github.com/pterodactyl/sftp-server/releases/download/$(curl --silent "https://api.github.com/repos/pterodactyl/sftp-server/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')/sftp-server -o /srv/daemon/sftp-server
    else
        echo -i "Config already set up for golang sftp server"
    fi
fi