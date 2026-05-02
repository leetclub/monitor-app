# Build stage — run from repo: docker build -t monitoring-app-v2 ./monitoring-app-v2
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache jq su-exec && mkdir -p /etc/nginx/includes
COPY nginx-main.conf /etc/nginx/nginx.conf
COPY nginx-security-headers.conf /etc/nginx/includes/security-headers.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
# nginx worker runs as non-root; entrypoint (root) writes /config.js then drops privileges
RUN mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp \
  && chown -R nginx:nginx /tmp/nginx
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
