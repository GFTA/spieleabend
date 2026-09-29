# Built from the repo root (see docker-compose.yml: context "..", GAME = this folder),
# so the shared room server in ../shared comes along. The game sits in /app/game and
# finds it at ../shared, exactly like in the repo.
FROM node:22-alpine
ARG GAME
WORKDIR /app/game
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY ${GAME}/package.json ${GAME}/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY shared /app/shared
COPY ${GAME}/server.js ./
COPY ${GAME}/public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/info >/dev/null || exit 1
CMD ["node", "server.js"]
