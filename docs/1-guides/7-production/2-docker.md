# Docker Deployment

The classic approach. Run your app on a VPS (DigitalOcean, Hetzner, AWS EC2) or any container platform (Fly.io, Railway, ECS).

## Quick Start

```bash
# Build with Docker support
npx alepha build --docker

# Build the image
docker build -t my-app ./dist

# Run it
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgres://... \
  -e APP_SECRET=your-secret-key \
  my-app
```

The generated Dockerfile is lean. We prune `node_modules` to production dependencies only, so your image stays small.

## What Gets Generated

```
dist/
├── index.js          # Your compiled server
├── public/           # Static assets (CSS, JS, images)
├── Dockerfile        # Ready-to-build Docker image
└── package.json      # Production dependencies only
```

## Production Configuration

### Basic docker-compose.yml

```yaml
version: "3.8"

services:
  app:
    build: ./dist
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://postgres:postgres@db:5432/app
      - APP_SECRET=${APP_SECRET}
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_DB=app
      - POSTGRES_PASSWORD=postgres

volumes:
  postgres_data:
```

### Health Checks

Add health checks to your Docker configuration:

```yaml
services:
  app:
    # ...
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

This requires `AlephaServerHealth` module to be enabled in your app.

## Deployment Platforms

### Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch (first time)
cd dist && fly launch

# Deploy (subsequent)
npx alepha build --docker && cd dist && fly deploy
```

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
npx alepha build --docker
cd dist && railway up
```

### AWS ECS / Fargate

1. Build and push to ECR:
```bash
npx alepha build --docker
docker build -t my-app ./dist
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URL
docker tag my-app:latest $ECR_URL/my-app:latest
docker push $ECR_URL/my-app:latest
```

2. Deploy via your preferred method (Terraform, CDK, Console).

## Performance Tips

### Multi-stage Build

The generated Dockerfile already uses multi-stage builds. If you need to customize:

```dockerfile
# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# Production stage
FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./
RUN npm prune --production
EXPOSE 3000
CMD ["node", "index.js"]
```

### Image Size Optimization

- Use Alpine-based images (`node:22-alpine`)
- Prune dev dependencies in production
- Use `.dockerignore` to exclude unnecessary files

```dockerignore
node_modules
.git
*.md
test
coverage
```
