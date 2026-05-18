FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./web/
WORKDIR /app/web
RUN pnpm install --frozen-lockfile
WORKDIR /app
COPY web ./web
RUN mkdir -p ./web/shared-src/contracts ./web/shared-src/realtime
COPY src/contracts/index.ts ./web/shared-src/contracts/index.ts
COPY src/realtime/protocol.ts ./web/shared-src/realtime/protocol.ts
WORKDIR /app/web
RUN pnpm build

FROM nginx:1.27-alpine AS runtime
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
