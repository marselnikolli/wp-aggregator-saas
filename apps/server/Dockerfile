FROM node:20-alpine
WORKDIR /app

# Install system dependencies (openssl for Prisma + Python/Playwright for Scrapling)
RUN apk add --no-cache openssl python3 py3-pip chromium udev ttf-freefont fontconfig bash

# Install Scrapling Python dependencies
RUN pip3 install --break-system-packages curl_cffi httpx 2>&1 | tail -5



COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

COPY entrypoint.sh ./
COPY scrapling_proxy.py ./
RUN chmod +x entrypoint.sh

EXPOSE 3001 3002
ENTRYPOINT ["./entrypoint.sh"]
