FROM node:22-alpine


ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8084

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY public ./public
COPY questions ./questions

RUN apk add --no-cache su-exec
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data

VOLUME ["/data"]
EXPOSE 8084

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

# Version (wird von GitHub Actions gesetzt, für die Update-Anzeige)
ARG GIT_SHA=dev
ARG BUILD_DATE=
ENV APP_VERSION=$GIT_SHA BUILD_DATE=$BUILD_DATE

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
