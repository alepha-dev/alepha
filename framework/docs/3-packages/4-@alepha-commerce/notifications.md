# @alepha/commerce - Notifications

## Installation

```bash
npm install @alepha/commerce
```

## Overview

The two customer-facing order emails: confirmation and shipping notice,
sent by the jobs of `@alepha/commerce/settlement`.

A separate module because a point-of-sale sends neither - it hands over a
receipt across a counter - and because the wording is brand-sensitive enough
that many consumers will want to replace it wholesale:

```ts
alepha.with({ provide: OrderMailRenderer, use: MyMails });
```

## API Reference

### Providers

- [`OrderMailRenderer`](/docs/reference-providers-ordermailrenderer) - Writes the customer-facing order emails.
