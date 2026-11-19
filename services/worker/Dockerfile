# Thesis worker: watcher + keeper + indexer + volatility keeper (one process).
# Build context: the repository root.
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile && chown -R node:node /app
ENV NODE_ENV=production
# The keeper key arrives via KEEPER_SECRET_KEY; nothing here needs root.
USER node
CMD ["pnpm", "exec", "tsx", "services/worker/src/index.ts"]
