# @alepha/ui - I18n En

## Installation

```bash
npm install @alepha/ui
```

## Overview

The English catalogue for every key `@alepha/ui` asks for.

The components default to English already; this record is for an application
whose fallback language is not English, where a key missing from the `en`
catalogue would otherwise be read in the fallback language. A plain record
the application spreads into its own catalogue, and a subpath of its own so
that catalogue can load it lazily:

```ts
en = $dictionary({
  lazy: async () => {
    const { uiEn } = await import("@alepha/ui/i18n/en");
    return { default: { ...uiEn, "nav.home": "Home" } };
  },
});
```
