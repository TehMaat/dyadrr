# syntax=docker/dockerfile:1
# L'immagine di Dyadrr per Wayfinderr (studio §14.2): Node 22, ffmpeg 6.1.2,
# mkvtoolnix 92.0 e tini dai pacchetti di Alpine 3.22, amd64 e arm64. Per
# default lancia il runner dei file job (§14.1).

# Il TypeScript si compila una volta, sulla piattaforma della build.
FROM --platform=$BUILDPLATFORM node:22-alpine3.22 AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run build

FROM alpine:3.22 AS runtime
# Versioni fissate con "~": la revisione di Alpine può cambiare, la versione no.
RUN apk add --no-cache 'nodejs~22' 'ffmpeg~6.1.2' 'mkvtoolnix~92.0' 'tini~0.19'
WORKDIR /app
COPY package.json ./
COPY --from=build /src/dist ./dist
RUN chmod +x dist/bin.js dist/runner-bin.js \
 && ln -s /app/dist/bin.js /usr/local/bin/dyadrr \
 && ln -s /app/dist/runner-bin.js /usr/local/bin/dyadrr-runner
WORKDIR /data
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["dyadrr-runner"]

# La suite (npm test) sull'immagine: gli stessi Node, ffmpeg e mkvtoolnix, più
# npm, i sorgenti e i test. Non si pubblica.
FROM runtime AS test
RUN apk add --no-cache npm
WORKDIR /test
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
CMD ["npm", "test"]
