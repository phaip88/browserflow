# syntax=docker/dockerfile:1.7
# Multi-stage build shared by api/web (target: api), browser-worker/scheduler (target: worker), and all-in-one standalone.
FROM node:22.22.1-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm if [ -f package-lock.json ]; then npm ci --ignore-scripts; else npm install --ignore-scripts; fi && npm rebuild argon2

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
RUN npm run build

# ---------- API / Web (no browser binaries) ----------
FROM node:22.22.1-bookworm-slim AS api
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 BROWSERFLOW_EMBEDDED_SUPERVISOR=false BROWSERFLOW_SERVICE=api
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -r browserflow && useradd -r -g browserflow -m -d /home/browserflow browserflow
WORKDIR /app
COPY --from=build --chown=browserflow:browserflow /app/.next ./.next
COPY --from=build --chown=browserflow:browserflow /app/public ./public
COPY --from=build --chown=browserflow:browserflow /app/node_modules ./node_modules
COPY --chown=browserflow:browserflow package.json next.config.ts tsconfig.json drizzle.config.json ./
COPY --chown=browserflow:browserflow src ./src
COPY --chown=browserflow:browserflow scripts ./scripts
COPY --chown=browserflow:browserflow scheduler ./scheduler
COPY --chown=browserflow:browserflow worker ./worker
RUN mkdir -p /app/data /app/runtime /app/secrets && chown -R browserflow:browserflow /app/data /app/runtime /app/secrets
USER browserflow
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["npx","next","start","-H","0.0.0.0","-p","3000"]

# ---------- Browser worker / scheduler (Chromium installed at build time, version pinned by playwright@1.52.0) ----------
FROM node:22.22.1-bookworm-slim AS worker
ENV NODE_ENV=production BROWSERFLOW_SERVICE=browser-worker PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends tini postgresql-client && rm -rf /var/lib/apt/lists/* \
 && groupadd -r browserflow && useradd -r -g browserflow -m -d /home/browserflow browserflow
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.json ./
COPY src ./src
COPY worker ./worker
COPY scheduler ./scheduler
COPY scripts ./scripts
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright && mkdir -p /app/data /app/runtime && chown -R browserflow:browserflow /app/data /app/runtime
USER browserflow
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["npx","tsx","worker/main.ts"]

# ---------- All-in-one Standalone (API + Scheduler + Browser Worker + Embedded/Remote PostgreSQL) ----------
FROM node:22.22.1-bookworm-slim AS standalone
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 BROWSERFLOW_EMBEDDED_SUPERVISOR=true BROWSERFLOW_SERVICE=api PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN apt-get update && apt-get install -y --no-install-recommends postgresql postgresql-contrib tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -r browserflow && useradd -r -g browserflow -m -d /home/browserflow browserflow
WORKDIR /app
COPY --from=build --chown=browserflow:browserflow /app/.next ./.next
COPY --from=build --chown=browserflow:browserflow /app/public ./public
COPY --from=deps --chown=browserflow:browserflow /app/node_modules ./node_modules
COPY --chown=browserflow:browserflow package.json next.config.ts tsconfig.json drizzle.config.json ./
COPY --chown=browserflow:browserflow src ./src
COPY --chown=browserflow:browserflow scripts ./scripts
COPY --chown=browserflow:browserflow scheduler ./scheduler
COPY --chown=browserflow:browserflow worker ./worker
RUN npx playwright install --with-deps chromium && chmod -R a+rX /ms-playwright \
 && chmod +x /app/scripts/entrypoint.sh \
 && mkdir -p /app/data /app/runtime /app/secrets && chown -R browserflow:browserflow /app/data /app/runtime /app/secrets
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini","--","/app/scripts/entrypoint.sh"]
CMD ["npx","next","start","-H","0.0.0.0","-p","3000"]
