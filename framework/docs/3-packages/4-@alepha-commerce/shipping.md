# @alepha/commerce - Shipping

## Installation

```bash
npm install @alepha/commerce
```

## Overview

Zone-and-rate delivery pricing.

A separate module because a great many consumers of this domain never ship
anything: a point-of-sale hands goods over the counter, a ticketing app sells
a QR code. Neither should carry two tables and a service it cannot use.

Importing this module is the whole integration - it claims the checkout's
`ShippingQuoteProvider` slot, and delivery starts being priced. Remove the
import and the checkout goes back to charging nothing for delivery, with no
other code change.

## API Reference

### Providers

- [`TableShippingQuoteProvider`](/docs/reference-providers-tableshippingquoteprovider) - Answers the checkout's shipping question from the zone/rate tables.
