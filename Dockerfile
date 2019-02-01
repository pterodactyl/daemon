FROM node:8-alpine

LABEL author="Michael Parker" maintainer="parker@pterodactyl.io"

COPY . /srv/daemon

WORKDIR /srv/daemon

RUN apk add --no-cache openssl make gcc g++ python linux-headers paxctl gnupg tar zip unzip coreutils zlib \
 && npm install --production \
 && addgroup -S pterodactyl && adduser -S -D -H -G pterodactyl -s /bin/false pterodactyl \
 && apk del --no-cache make gcc g++ python linux-headers paxctl gnupg \
 && mkdir /lib64 && ln -s /lib/libc.musl-x86_64.so.1 /lib64/ld-linux-x86-64.so.2

EXPOSE 8080

ENTRYPOINT ["/bin/ash", "/srv/daemon/entrypoint.sh"]

CMD ["npm", "start"]