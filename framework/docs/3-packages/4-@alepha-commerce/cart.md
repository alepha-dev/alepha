# @alepha/commerce - Cart

## Installation

```bash
npm install @alepha/commerce
```

## Overview

Server-side baskets.

A separate module because a consumer can genuinely not want it: a
point-of-sale builds an order at the counter and never has a basket to
persist, and shipping two unused tables into its migrations would be a cost
with no return.

## API Reference

### Providers

- [`CartDiscountProvider`](/docs/reference-providers-cartdiscountprovider) - Where a cart asks whether it earned a discount.
