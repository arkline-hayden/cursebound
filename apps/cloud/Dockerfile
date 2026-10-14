# CURSEBOUND cloud service image. Build from the REPO ROOT (the workspace packages are needed):
#   docker build -f apps/cloud/Dockerfile -t cursebound-cloud .
# Stage 1 installs only the cloud workspace's dependency tree and bundles it with esbuild into one file;
# stage 2 is node:22-slim with that bundle and nothing else, running as the unprivileged `node` user.
# Runtime env: DATABASE_URL (a Cloud SQL socket works: postgres://u:p@/cursebound?host=/cloudsql/P:R:I),
# TURN_SECRET, TURN_HOST, CORS_ORIGINS, MIN_CLIENT_BUILD; Cloud Run sets PORT (8080).

FROM node:22-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci --workspace @cursebound/cloud --no-audit --no-fund \
 && npm run build --workspace @cursebound/cloud

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/cloud/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main.mjs"]
