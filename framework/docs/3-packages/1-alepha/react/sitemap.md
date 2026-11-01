# Alepha - React Sitemap

## Installation

Part of the `alepha` package. Import from `alepha/react/sitemap`.

```bash
npm install alepha
```

## Overview

Sitemap, robots and web app manifest generation for React applications.

Exposes the `$sitemap` primitive, which serves a `sitemap.xml` built
from the app's `$page` primitives - live at request time and prerendered to a
static file at build time - `$robots`, a `robots.txt` that answers by
host, and `$manifest`.

## API Reference

### Primitives

- [`$manifest`](/docs/reference-primitives-$manifest) - Serve a web app manifest generated from code, and link it from every page.
- [`$robots`](/docs/reference-primitives-$robots) - Serve a `robots.txt` generated from code.
- [`$sitemap`](/docs/reference-primitives-$sitemap) - Expose a `sitemap.xml` generated from the application's `$page` primitives.
