FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime: nginx to serve static files ---
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY docker-entrypoint-railway.sh /docker-entrypoint-railway.sh
RUN chmod +x /docker-entrypoint-railway.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint-railway.sh"]
