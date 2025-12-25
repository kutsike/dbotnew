# Minimal production image
FROM node:18-bullseye

# Chromium for WhatsApp Web
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY . .

ENV NODE_ENV=production \
  PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3000
CMD ["node", "index.js"]
