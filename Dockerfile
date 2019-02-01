FROM node:8-alpine

LABEL author="Michael Parker" maintainer="parker@pterodactyl.io"

COPY . /srv/daemon

WORKDIR /srv/daemon

RUN apk add --no-cache openssl make gcc g++ python linux-headers paxctl gnupg tar zip unzip coreutils zlib \
 && npm install --production \
 && addgroup -S pterodactyl && adduser -S -D -H -G pterodactyl -s /bin/false pterodactyl \
 && apk del --no-cache make gcc g++ python linux-headers paxctl gnupg

EXPOSE 8080

CMD ["npm", "start"]