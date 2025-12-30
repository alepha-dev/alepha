# Environment Variables

Alepha loads environment variables from `.env` files in development. In production, use your platform's environment configuration.

## Required Variables

Every production deployment needs:

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | Set to `production` |
| `APP_SECRET` | Long random string for signing cookies and tokens |
| `DATABASE_URL` | Your database connection string |

### Generating APP_SECRET

```bash
# Generate a secure random string
openssl rand -base64 32
```

Use a different secret for each environment (development, staging, production).

## Database URLs

### PostgreSQL

```env
# Standard format
DATABASE_URL=postgres://user:pass@host:5432/database

# With SSL (required for most cloud providers)
DATABASE_URL=postgres://user:pass@host:5432/database?sslmode=require
```

### Cloudflare D1

```env
DATABASE_URL=cloudflare-d1://binding-name:database-id
```

### SQLite (Local Development)

```env
DATABASE_URL=sqlite://./data.db
```

## Platform-Specific Variables

### Vercel

```env
VERCEL_PROJECT_ID=prj_...
VERCEL_ORG_ID=team_...
BLOB_READ_WRITE_TOKEN=vercel_blob_...
```

### Cloudflare

```env
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
```

### AWS

```env
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
```

## Storage Provider Variables

### S3-Compatible

```env
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=us-east-1
S3_ENDPOINT=https://... # Optional, for non-AWS S3
S3_FORCE_PATH_STYLE=true # Optional, for MinIO
```

### Vercel Blob

```env
BLOB_READ_WRITE_TOKEN=vercel_blob_...
```

### Azure Blob

```env
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
```

## Email & SMS

### SMTP

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG...
SMTP_FROM=noreply@example.com
```

### Twilio (SMS)

```env
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1234567890
```

## Redis

```env
REDIS_URL=redis://localhost:6379
# or with authentication
REDIS_URL=redis://:password@host:6379
```

## Environment Files

Alepha supports multiple `.env` files:

```
.env                # Default, loaded in all environments
.env.local          # Local overrides (gitignored)
.env.development    # Development-specific
.env.production     # Production-specific
.env.test           # Test-specific
```

Load order (later files override earlier):
1. `.env`
2. `.env.local`
3. `.env.[mode]`
4. `.env.[mode].local`

## Type-Safe Environment Variables

Define and validate environment variables with `$env`:

```typescript
import { $env } from "alepha";

class Config {
  env = $env({
    DATABASE_URL: t.string(),
    APP_SECRET: t.string({ minLength: 32 }),
    SMTP_HOST: t.optional(t.string()),
    MAX_UPLOAD_SIZE: t.optional(t.integer({ default: 10 })),
  });
}
```

Access validated values:

```typescript
const config = inject(Config);
const dbUrl = config.env.DATABASE_URL; // string (validated)
const maxSize = config.env.MAX_UPLOAD_SIZE; // number (with default)
```

## Security Best Practices

1. **Never commit secrets** - Use `.env.local` for local secrets, add to `.gitignore`
2. **Use different secrets per environment** - Development, staging, production should have unique `APP_SECRET`
3. **Rotate secrets regularly** - Especially after team member changes
4. **Use platform secret management** - Vercel, Cloudflare, AWS all have secure secret storage
5. **Validate at startup** - Use `$env` to fail fast on missing variables
