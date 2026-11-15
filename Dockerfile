# ops-console — Astro SSR (@astrojs/node standalone) production image.
# Built for OrbStack / any OCI runtime. node:22-slim resolves to v22.23.4, which
# satisfies both package.json `engines.node >=22.12.0` and Astro's >=22.23.4
# floor, and is already present on this machine (no slow Docker Hub pull).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
# Production deps only: the standalone server still needs `react`/`react-dom`/
# `astro`/`@astrojs/*` at render time, all of which are runtime dependencies.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# OPS_HOST is overridden to 0.0.0.0 at run time (config.ts defaults to 127.0.0.1,
# which would never receive a mapped port inside the container).
EXPOSE 3022
CMD ["node", "--experimental-sqlite", "dist/server/entry.mjs"]
