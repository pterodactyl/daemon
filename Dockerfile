FROM node:10-alpine

LABEL author="Michael Parker" maintainer="parker@pterodactyl.io"

COPY . /srv/daemon

WORKDIR /srv/daemon

RUN apk add --no-cache openssl make gcc g++ python linux-headers paxctl gnupg tar zip unzip curl coreutils zlib supervisor jq \
 && npm install --production \
 && addgroup -S pterodactyl && adduser -S -D -H -G pterodactyl -s /bin/false pterodactyl \
 && apk del --no-cache make gcc g++ python linux-headers paxctl gnupg \
 && curl -sSL https://github.com/pterodactyl/sftp-server/releases/download/$(curl --silent "https://api.github.com/repos/pterodactyl/sftp-server/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')/sftp-server > /srv/daemon/sftp-server \
 && mkdir -p /var/log/supervisord /lib64 && ln -s /lib/libc.musl-x86_64.so.1 /lib64/ld-linux-x86-64.so.2 \
 && chmod +x /srv/daemon/sftp-server \
 && chmod +x /srv/daemon/.docker/entrypoint.sh \
 && cp /srv/daemon/.docker/supervisord.conf /etc/supervisord.conf

EXPOSE 8080

ENTRYPOINT [ "/bin/ash", "/srv/daemon/.docker/entrypoint.sh" ]

CMD [ "supervisord", "-n", "-c", "/etc/supervisord.conf" ]