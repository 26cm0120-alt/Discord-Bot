FROM node:24.17.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY assets ./assets
RUN mkdir -p /data && chown node:node /data
USER node

CMD ["node", "src/main.js"]

