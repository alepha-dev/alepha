# @alepha/commerce - Promotions

## Installation

```bash
npm install @alepha/commerce
```

## Overview

Discount codes and automatic discounts.

Importing it is the whole integration: it plugs into the cart's
`CartDiscountProvider`, and carts start earning discounts. A discount lowers
the tax-inclusive line totals, so VAT is computed on what is paid, and the
order and the invoice freeze it.

Imports the cart and not the checkout, though checkout is what reads it:
importing the checkout would wire it here, and `shipping`, which substitutes
into it, would then come too late.

## API Reference

### Providers

- [`PromotionDiscountSource`](/docs/reference-providers-promotiondiscountsource) - Answers the cart's discount question from the promotion tables: the plugin
