#!/bin/ash
## Ensure we are in /srv/daemon

CORE_CHECK=$(grep -o '"enabled": false,' /srv/daemon/config/core.json)

if [ $CORE_CHECK != '"enabled": false,' ]; then
    echo -e "Updating config to enable sftp-server."
    sed -i 's/        "ip": "0.0.0.0",/        "ip": "0.0.0.0",\n        "enabled": false,/g' /srv/daemon/config/core.json
else
    echo -e "Config already set up for golang sftp server"
fi

exec "$@"