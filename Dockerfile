FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npm run validate:env && npm run db:migrate && npm run db:seed && npm run db:ensure-staff && npm run start"]
