FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @tlwb/web build

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
# Static file serving and reverse proxying on an unprivileged port need
# no root: /config/caddy and /data/caddy are already world-writable in
# this image, and /srv and /etc/caddy only need to be read.
USER nobody:nobody
EXPOSE 8080
