FROM alpine:3.7

# Create app directory
WORKDIR /app

RUN apk add --no-cache nodejs nodejs-npm tar unzip make gcc g++ python && \
    python -m ensurepip && \
    rm -r /usr/lib/python*/ensurepip && \
    pip install --upgrade pip setuptools && \
    if [ ! -e /usr/bin/pip ]; then ln -s pip /usr/bin/pip ; fi && \
    if [[ ! -e /usr/bin/python ]]; then ln -sf /usr/bin/python /usr/bin/python; fi && \
    rm -r /root/.cache

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install --only=production --save
# If you are building your code for production
# RUN npm install --only=production

COPY . ./
RUN cp -r .dev/docker/root/* /

ENTRYPOINT ["/bin/ash", "/app/entrypoint.sh"]

EXPOSE 8080
EXPOSE 2022

CMD [ "/usr/bin/npm", "start" ]