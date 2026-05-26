# syntax=docker/dockerfile:1.7
#
# Alepha Rocket — remote `alepha platform` runner.
#
# Build: `yarn workspace rocket build` produces a self-contained `dist/`
# (no runtime deps in dist/package.json — everything is bundled). This
# image copies that dist, plus installs `alepha` and `wrangler` globally
# so the future deploy pipeline can shell out to them when needed.
#
# Publish: tag as `alepha/rocket:<version>` and `alepha/rocket:latest`.

FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Global tooling — `wrangler` is still required for `wrangler deploy
# --no-bundle` and `wrangler d1 migrations apply --remote` until the
# REST-only port lands. `alepha` is installed so `npx alepha` resolves
# instantly inside the container (debugging + fallback shell-out).
RUN npm install --global --no-fund --no-audit \
      alepha \
      wrangler

# App bundle. `dist/package.json` has zero runtime deps because the
# Alepha build inlines everything — no `npm install` step needed.
COPY dist/ ./dist/

EXPOSE 3000

CMD ["node", "dist/index.js"]
