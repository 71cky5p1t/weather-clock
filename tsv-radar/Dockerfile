FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY IDR1064.background.jpg /mnt/data/IDR1064.background.jpg

ENV PORT=8787
EXPOSE 8787

CMD ["node", "server.js"]
