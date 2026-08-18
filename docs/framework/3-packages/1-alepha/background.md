# Alepha - Background

## Installation

Part of the `alepha` package. Import from `alepha/background`.

```bash
npm install alepha
```

## Overview

Fire-and-forget background work that should outlive the request that
scheduled it, without blocking the response.

Inject {@link BackgroundTaskProvider} and call `defer(() => …)`:

```ts
protected readonly background = $inject(BackgroundTaskProvider);

createUser = $action({ handler: async ({ body }) => {
  const user = await this.users.create(body);
  this.background.defer(() => this.email.send(welcome(user))); // don't block
  return user;
}});
```

On Node/Vercel the event loop keeps the task alive. On Cloudflare Workers the
`workerd` build swaps in {@link WorkerdBackgroundTaskProvider}, which wraps
the task in `executionCtx.waitUntil` so the isolate isn't frozen at response
time — the call site is identical either way.

## API Reference

### Providers

- [`BackgroundTaskProvider`](/docs/reference-providers-backgroundtaskprovider) — Runs fire-and-forget work that should outlive the request that scheduled it
- [`WorkerdBackgroundTaskProvider`](/docs/reference-providers-workerdbackgroundtaskprovider) — Cloudflare Workers variant of {@link BackgroundTaskProvider}.
