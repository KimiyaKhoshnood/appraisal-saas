# syntax=docker/dockerfile:1.7
# One multi-stage build for the monorepo; targets: api, tools (migrate/seed), web.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# Dependencies first: this layer is reused until a manifest or the lockfile changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @appraisal/contracts build \
 && pnpm --filter @appraisal/api exec prisma generate \
 && pnpm --filter @appraisal/api build \
 && pnpm --filter @appraisal/web build

# Operator image: bootstrap roles, migrate as the schema owner, sync catalogs, seed.
FROM build AS tools
WORKDIR /repo/apps/api
CMD ["sh", "-c", "pnpm db:bootstrap && pnpm db:migrate && pnpm db:catalog && if [ \"$SEED\" = \"true\" ]; then pnpm db:seed; fi"]

# Runtime API: stateless (NF-10), runs as the unprivileged node user and the runtime DB role.
FROM build AS api
ENV NODE_ENV=production
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/main.js"]

# Static front-end behind nginx, which also load-balances /api across API replicas.
FROM nginx:1.29-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
