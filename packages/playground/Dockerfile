FROM node:23-alpine
WORKDIR /app

COPY dist .
USER node

ENV NODE_ENV=production
ENV DATABASE_URL=postgres://postgres:postgres@host.docker.internal:5432/postgres
ENV SERVER_HOST=0.0.0.0

EXPOSE 3000

CMD ["node", "server/index.server.js"]
