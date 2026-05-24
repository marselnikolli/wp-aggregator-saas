FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY package.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./entrypoint.sh"]
