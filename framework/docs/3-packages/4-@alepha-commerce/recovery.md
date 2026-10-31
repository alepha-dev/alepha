# @alepha/commerce - Recovery

## Installation

```bash
npm install @alepha/commerce
```

## Overview

Abandoned-cart follow-up: two reminder emails and an abandoned mark, as
one durable job per cart.

Starts when a checkout captures an email AND the buyer agreed to be reminded
(`commerce:checkout:emailCaptured`, `recoveryConsent`): in the EU a reminder to
somebody who has not bought is prospecting, and needs a lawful basis and an
easy way out. Every reminder carries a one-click unsubscribe, and the opt-out
list outlives the cart. It waits out its delays on the job's own execution row (restarts lose
nothing) and stands down the moment the checkout converts. Timings come
from `cartRecoveryConfig`; the wording from `CartRecoveryMailRenderer`,
substitutable like the order mails:

```ts
alepha.with({ provide: CartRecoveryMailRenderer, use: MyReminders });
```

## API Reference

### Providers

- [`CartRecoveryMailRenderer`](/docs/reference-providers-cartrecoverymailrenderer) - Writes the abandoned-cart reminder emails.
