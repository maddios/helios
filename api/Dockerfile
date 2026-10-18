FROM mwader/static-ffmpeg:7.1.1@sha256:11a44711684c0b9f754c047dcd64235b8b52deab251bd0e0a86f22faa160749c AS ffmpeg

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS build
ENV MONGOMS_DISABLE_POSTINSTALL=1
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY contracts/package.json contracts/
COPY core/package.json core/
COPY worker/package.json worker/
COPY api/package.json api/
RUN npm ci
COPY contracts contracts
COPY core core
COPY api api
RUN npm run build:api

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
COPY --from=ffmpeg /ffprobe /usr/local/bin/
WORKDIR /app
COPY --from=build /app/node_modules/swagger-ui-express/package.json /tmp/swagger.package.json
RUN npm install --omit=dev --no-save --no-package-lock "swagger-ui-express@$(node -p "require('/tmp/swagger.package.json').version")" \
	&& npm cache clean --force \
	&& rm /tmp/swagger.package.json
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production FFPROBE_PATH=/usr/local/bin/ffprobe
USER node
CMD ["node", "dist/api/main.js"]

FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS test
COPY --from=ffmpeg /ffprobe /usr/local/bin/
ENV MONGOMS_DISABLE_POSTINSTALL=1 FFPROBE_PATH=/usr/local/bin/ffprobe
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY contracts/package.json contracts/
COPY core/package.json core/
COPY worker/package.json worker/
COPY api/package.json api/
RUN npm ci
COPY contracts contracts
COPY core core
COPY api api
CMD ["npx", "tsx", "local/runApi.ts"]
