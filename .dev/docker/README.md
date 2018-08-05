# Dockerized Wings daemon

## Build
execute the following command in project root
```docker build -t <repo>/<image>:<tag> .```

## Start
If you use SSL Connection, do not forget to setup letsencrypt on the host
```
docker run \
-p 8080:8080 \
-p 2022:2022 \
-v /tmp/pterodactyl/:/tmp/pterodactyl/ \
-v /srv/daemon-data/:/srv/daemon-data/ \
-v /etc/pterodactyl/:/app/config/ \
-v /var/run/docker.sock:/var/run/docker.sock \
-v /etc/letsencrypt/:/etc/letsencrypt/ \
-e PANEL_URL=<panel url> \
-e TOKEN=<token> \
-d <repo>/<image>:<tag>
```
If you choose to save the config, PANEL_URL and TOKEN will not be necessary on future starts.

## Ports
 - 8080 for management
 - 2022 for sftp

## Volumes
 - `/tmp/pterodactyl/` used for installing containers, must be mapped on same path on host
 - `/srv/daemon-data/` used for running containers, must be mapped on same path on host
 - `/var/run/docker.sock` path of the docker socket file, usualy same path on host
 - `/app/config/` path of the pterodactyl daemon config, can be what you want
 - `/etc/letsencrypt/` path of the certbot certs for ssl/tls, needed only for ssl/tls

## Environement variables (used for deploying new nodes)
 - `PANEL_URL` the panel external address
 - `TOKEN` the link token