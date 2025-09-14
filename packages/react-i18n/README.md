# Alepha React I18n

Internationalization (i18n) support for React applications using Alepha.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Add i18n support to your Alepha React application. SSR and CSR compatible.

It supports lazy loading of translations and provides a context to access the current language.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaReactI18n } from "alepha/react/i18n";

const alepha = Alepha.create()
	.with(AlephaReactI18n);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $dictionary()

Register a dictionary entry for translations.

It allows you to define a set of translations for a specific language.
Entry can be lazy-loaded, which is useful for large dictionaries or when translations are not needed immediately.

```ts
import { $dictionary } from "alepha/react-i18n";

const Example = () => {
  const { tr } = useI18n<App, "en">();
  return <div>{tr("hello")}</div>; //
}

class App {

  en = $dictionary({
    // { default: { hello: "Hey" } }
    lazy: () => import("./translations/en.ts"),
  });

  home = $page({
    path: "/",
    component: Example,
  })
}

run(App);
```

### Hooks

Hooks provide a way to tap into various lifecycle events and extend functionality. They follow the convention of starting with `use` and return configured hook instances.

#### useI18n()

Hook to access the i18n service.
