# $dictionary

## Import

```typescript
import { $dictionary } from "alepha/react/i18n";
```

## Overview

Register a dictionary entry for translations.

It allows you to define a set of translations for a specific language.
Entry can be lazy-loaded, which is useful for large dictionaries or when translations are not needed immediately.

## Options

| Option | Type     | Required | Description |
| ------ | -------- | -------- | ----------- |
| `lang` | `string` | No       |             |
| `name` | `string` | No       |             |
| `lazy` | `Object` | Yes      |             |

## Examples

```tsx
import { run } from "alepha";
import { $dictionary, useI18n } from "alepha/react/i18n";
import { $page } from "alepha/react/router";

const Example = () => {
  const { tr } = useI18n<App, "en">();
  return <div>{tr("hello")}</div>; // "Hey"
};

class App {
  en = $dictionary({
    // { default: { hello: "Hey" } }
    lazy: () => import("./translations/en.ts"),
  });

  home = $page({
    path: "/",
    component: Example,
  });
}

run(App);
```
