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

One more field matters on a non-default install: if Bay's root is not
`$HOME/bay-data`, set `socket` to the absolute path of the control socket -
without it, every command the adapter sends fails to find the server.

## HTTPS

Started with `--tls`, Bay obtains a certificate for every app's domain and
answers plain HTTP on port 80 with a `308` to the same address over HTTPS, so a
visitor who types the address or follows an `http://` link never gets the site
unencrypted. Port 80 still answers the ACME HTTP-01 challenge first, and a host
no app is registered for keeps its `404`.

⚠️ If a Cloudflare proxy sits in front of Bay, set its SSL mode to **Full
(strict)**, never **Flexible**. Flexible talks plain HTTP to the origin, so
every request is redirected back to HTTPS and the browser reports "too many
redirects", with nothing in Bay's logs to say why.

## Installing Bay

Bay is written in Go and ships as a static Linux binary on every release, for
`amd64` and `arm64`, alongside a `SHA256SUMS` file. Download the binary for your
architecture from the [GitHub releases](https://github.com/alepha-dev/alepha/releases),
verify the checksum, and run it. The releases also expose stable
`releases/latest/download/bay-linux-<arch>` URLs for scripted installs.
