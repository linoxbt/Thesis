# Thesis worker: watcher + keeper + indexer + volatility keeper (one process).
# Build context: the repository root.
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
ENV NODE_ENV=production
CMD ["pnpm", "exec", "tsx", "services/worker/src/index.ts"]
