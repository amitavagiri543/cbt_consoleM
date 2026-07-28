#!/bin/sh
set -e

BACKEND_URL="${BACKEND_URL:-http://cbe-backend:3000}"
BACKEND_HOST=$(echo "${BACKEND_URL}" | sed -E 's|^https?://([^/:]+).*|\1|')

cat > /etc/nginx/conf.d/default.conf <<NGINX_EOF
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  # SSE — long-lived connection, disable buffering and extend timeouts
  location /api/sse {
    proxy_pass ${BACKEND_URL};
    proxy_set_header Host ${BACKEND_HOST};
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_ssl_server_name on;
    proxy_ssl_verify off;
    proxy_buffering off;
    proxy_cache off;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_connect_timeout 10s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;
  }

  location /api {
    proxy_pass ${BACKEND_URL};
    proxy_set_header Host ${BACKEND_HOST};
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_ssl_server_name on;
    proxy_ssl_verify off;
    proxy_connect_timeout 10s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;
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
