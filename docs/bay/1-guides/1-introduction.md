# Introduction

Bay is a self-hosted application server for Alepha apps.

Where Cloudflare gives you someone else's serverless platform, Bay runs your apps as
ordinary long-lived processes on a machine you own, with TLS, rollback and process
isolation handled for you.

## When to use it

- You want a long-lived runtime: background work between requests, in-process caches,
  a local SQLite file.
- You would rather pay for one VPS than per request.
- The data has to stay on hardware you control.

## Deploying to it

Bay has no `wrangler.jsonc` equivalent. Everything it needs is already in the build
manifest, so the target-specific story is one line of configuration:

```typescript
platform({
  environments: {
    production: {
      adapter: "bay",
      host: "deploy@bay.example.com",
      domain: "myapp.com",
    },
  },
});
```

Then `alepha platform up -e production`.

## Installing Bay

Bay is written in Go and ships as a static Linux binary on every release, for
`amd64` and `arm64`, alongside a `SHA256SUMS` file. Download the binary for your
architecture from the [GitHub releases](https://github.com/feunard/alepha/releases),
verify the checksum, and run it.
