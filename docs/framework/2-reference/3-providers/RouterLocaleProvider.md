# RouterLocaleProvider

## Import

```typescript
import { RouterLocaleProvider } from "alepha/react/router";
```

## Overview

Generic locale path-prefix mechanism for the router.

This provider knows nothing about i18n — it only deals with URL path
segments. It is configured by the i18n module (`I18nProvider`) when
`routing: "prefix"` is enabled, which keeps the dependency one-directional
(`i18n → router`) and avoids a module cycle.

The default locale is served WITHOUT a prefix (`/about` = default,
`/fr/about` = French). The active locale is derived from the current
request/navigation and stored under `alepha.react.router.locale`, so every
URL the router builds (`pathname()`) automatically carries the right prefix.

