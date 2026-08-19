# Alepha - Api Analytics

## Installation

Part of the `alepha` package. Import from `alepha/api/analytics`.

```bash
npm install alepha
```

## Overview

Portable analytics datasets.

Binds the relational provider under Node, and the memory provider under
test. `WaeAnalyticsProvider` is exported here too, and - unlike its first
design - it is now DI-constructible like any other provider (see its class
doc). It is still never auto-wired by *this* module's `register()`, though:
its write path reads a `cloudflare.env` binding that only exists inside a
Worker, so selecting it under Node would mean every `record()` call throws.
`index.workerd.ts` is the entry that selects it, gated on
`CLOUDFLARE_ANALYTICS_DATASET`.

`AnalyticsRollupJobs` is deliberately **not** wired here - see
`AlephaApiAnalyticsRollup` just below for why it is a separate module.
`AnalyticsRetentionGuard` *is* wired here, unconditionally, precisely to
catch an app that forgets the split: it `log.warn`s at boot if any
dataset declares `retention.hot` while no `AnalyticsRollupJobs` was ever
constructed.

## API Reference

### Primitives

- [`$analytics`](/docs/reference-primitives-$analytics) - Declares an analytics dataset: what you record, and what you can ask.

### Providers

- [`AnalyticsProvider`](/docs/reference-providers-analyticsprovider) - Where a dataset's rows live.
- [`MemoryAnalyticsProvider`](/docs/reference-providers-memoryanalyticsprovider) - An in-memory dataset, and the reference implementation of the seam.
- [`OrmAnalyticsProvider`](/docs/reference-providers-ormanalyticsprovider) - Two relational tables per dataset: raw hour buckets and rolled day buckets.
- [`WaeAnalyticsProvider`](/docs/reference-providers-waeanalyticsprovider) - Hot rows on Workers Analytics Engine, rolled rows in a durable store.

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLOUDFLARE_ACCOUNT_ID` | text | - | Cloudflare account id, for the Analytics Engine SQL read API (there is no read binding - see AnalyticsEngineSql). |
| `CLOUDFLARE_ANALYTICS_DATASET` | text | - | Analytics Engine dataset name - used both as the wrangler.toml binding key (env.<name>) for writes and as the SQL FROM table for reads. Unset means this provider is never selected; see index.workerd.ts. |
| `CLOUDFLARE_ANALYTICS_TOKEN` | text | - | API token scoped to Account Analytics Read, for the Analytics Engine SQL read API. Never a deploy credential. |
