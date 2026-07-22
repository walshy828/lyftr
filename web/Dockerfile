# Stage 1: Build — run on host platform to avoid QEMU slowness for npm/node
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

WORKDIR /app

# Playwright is a devDependency (used by `npm run test:e2e` only) but npm ci
# still installs it; skip its browser-binary postinstall download (Chromium/
# Firefox/WebKit, several hundred MB) since nothing in this image runs e2e tests.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install dependencies first (layer cache). Cache mount persists npm's package
# cache across builds so a package-lock.json change doesn't re-download every
# dependency from the registry.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM nginx:alpine

# Backend upstream for the /api proxy. Override at runtime (compose/`docker run -e`)
# when the backend runs on a non-default port, e.g. BACKEND_ORIGIN=backend:3008.
ENV BACKEND_ORIGIN=backend:3000
# Only substitute our own var so nginx runtime vars ($host, $uri, ...) are left intact.
ENV NGINX_ENVSUBST_FILTER=BACKEND_ORIGIN

# Custom nginx config for SPA + API proxy. nginx's entrypoint renders templates in
# /etc/nginx/templates/*.template through envsubst into /etc/nginx/conf.d/ on start.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
