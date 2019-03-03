#!/bin/ash
## Ensure we are in /srv/daemon

if [ $(cat /srv/daemon/config/core.json | jq -r '.sftp.enabled') == "null" ]; then
    echo -e "Updating config to enable sftp-server."
    cat /srv/daemon/config/core.json | jq '.sftp.enabled |= false' > /tmp/core
    cat /tmp/core > /srv/daemon/config/core.json
elif [ $(cat /srv/daemon/config/core.json | jq -r '.sftp.enabled') == "false" ]; then
    echo -e "Config already set up for golang sftp server"
else 
    echo -e "You may have purposly set the sftp to true and that will fail."
fi

exec "$@"