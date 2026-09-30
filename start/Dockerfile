# Built from the repo root (see docker-compose.yml: context "..") so avatars.js and profile.js
# come from ../shared, the single source the games use too.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY start/package.json start/server.js start/party.js start/games.json ./
COPY shared/avatars.js shared/profile.js ./shared/
COPY start/public ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/games.json >/dev/null || exit 1
CMD ["node", "server.js"]
