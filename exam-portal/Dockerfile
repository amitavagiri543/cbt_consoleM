FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# --- Runtime: nginx to serve static files ---
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html/examportal

# Entrypoint script to template nginx config with BACKEND_URL at runtime
RUN cat > /docker-entrypoint-railway.sh <<'ENTRY_EOF'
#!/bin/sh
set -e

BACKEND_URL="${BACKEND_URL:-http://cbe-backend:3000}"

# Parse BACKEND_URL into scheme, host, port
SCHEME=$(echo "$BACKEND_URL" | sed -n 's/^\(http[s]\?\):\/\/.*/\1/p')
HOSTPORT=$(echo "$BACKEND_URL" | sed -n 's/^http[s]\?:\/\/\([^/]*\).*/\1/p')
HOST=$(echo "$HOSTPORT" | cut -d: -f1)
PORT=$(echo "$HOSTPORT" | cut -d: -f2)
PORT="${PORT:-80}"

cat > /etc/nginx/conf.d/default.conf <<NGINX_EOF
server {
  listen \${PORT:-80};
  root /usr/share/nginx/html/examportal;
  index index.html;

  location /api {
    proxy_pass ${BACKEND_URL};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }

  location /ws {
    proxy_pass ${BACKEND_URL};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
  }

  location / {
    try_files \$uri \$uri/ /index.html;
  }
}
NGINX_EOF

exec nginx -g "daemon off;"
ENTRY_EOF

RUN chmod +x /docker-entrypoint-railway.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint-railway.sh"]
