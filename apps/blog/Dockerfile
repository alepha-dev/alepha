FROM node:24-alpine
WORKDIR /app

COPY dist ./dist
COPY drizzle ./drizzle
ENV NODE_ENV=production

CMD ["node", "dist/index.mjs"]
