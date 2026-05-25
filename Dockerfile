FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM deps AS migrator
ENV NODE_ENV=production
COPY tsconfig*.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
COPY scripts ./scripts
CMD ["sh", "-c", "test -n \"$DATABASE_URL\" && pnpm migrate && pnpm partition:maintain"]

FROM deps AS geo-import
ENV NODE_ENV=production
RUN apk add --no-cache gdal gdal-tools
COPY tsconfig*.json drizzle.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY data ./data
CMD ["pnpm", "geo:import"]

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
