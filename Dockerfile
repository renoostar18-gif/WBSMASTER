# WBS Master: one image runs the API and serves the built web app (Cloud Run, spec 8.2).
#   docker build -t wbs-master .
# Behind a TLS-inspecting proxy, pass its CA: docker build --secret id=ca,src=/path/ca.crt -t wbs-master .
ARG NODE_IMAGE=mirror.gcr.io/library/node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /src
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    npm install -g pnpm@10.28.0
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build
# the API with only its production dependencies (the engine is copied in as a package)
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    pnpm --filter @wbs-master/api deploy --prod --legacy /out

FROM ${NODE_IMAGE}
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web TRUST_PROXY=1
WORKDIR /app/api
COPY --from=build --chown=node:node /out/package.json ./
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /src/apps/api/dist ./dist
COPY --from=build --chown=node:node /src/apps/api/migrations ./migrations
COPY --from=build --chown=node:node /src/apps/web/dist /app/web
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
