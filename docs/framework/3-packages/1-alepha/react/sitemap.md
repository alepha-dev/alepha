# Alepha - React Sitemap

## Installation

Part of the `alepha` package. Import from `alepha/react/sitemap`.

```bash
npm install alepha
```

## Overview

Sitemap generation for React applications.

Exposes the `$sitemap` primitive, which serves a `sitemap.xml` built
from the app's `$page` primitives — live at request time and prerendered to a
static file at build time.

## API Reference

### Primitives

- [`$sitemap`](/docs/reference-primitives-$sitemap) — Expose a `sitemap.xml` generated from the application's `$page` primitives.
