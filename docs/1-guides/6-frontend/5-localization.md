# Localization

Alepha provides `$dictionary` for registering translations and `useI18n` for accessing them in React components. Translations are lazy-loaded per language and support SSR with cookie-based language selection and `Accept-Language` autodetection.

## Setup

Register translation dictionaries as class properties. The property name determines the language code.

```typescript
import { $dictionary } from "alepha/react/i18n";

class App {
  en = $dictionary({ lazy: () => import("./translations/en.ts") });
  fr = $dictionary({ lazy: () => import("./translations/fr.ts") });
}
```

Each translation file exports a default object mapping keys to strings:

```typescript
// translations/en.ts
export default {
  hello: "Hello",
  welcome: "Welcome, $1",
  items_count: "$1 items",
};
```

```typescript
// translations/fr.ts
export default {
  hello: "Bonjour",
  welcome: "Bienvenue, $1",
  items_count: "$1 elements",
};
```

Interpolation uses positional placeholders: `$1`, `$2`, `$3`, etc.

## $dictionary Options

| Option | Type                              | Description                                    |
|--------|-----------------------------------|------------------------------------------------|
| `lazy` | `() => Promise<{ default: T }>`  | Async loader for the translation module.       |
| `lang` | `string`                          | Language code. Defaults to the property name.  |
| `name` | `string`                          | Dictionary name. Defaults to the property name.|

### Multiple Dictionaries Per Language

You can split translations across files by using the `lang` option:

```typescript
class App {
  enCommon = $dictionary({
    lang: "en",
    lazy: () => import("./translations/en-common.ts"),
  });

  enDashboard = $dictionary({
    lang: "en",
    lazy: () => import("./translations/en-dashboard.ts"),
  });
}
```

All dictionaries for the same language are merged. Key lookups search all dictionaries for the current language.

## Lazy Loading

Only the current language and the fallback language (default: `"en"`) are loaded on startup. When the user switches languages, the new language's dictionaries are loaded on demand.

On the server, all languages are loaded at startup for SSR.

## useI18n Hook

```typescript
import { useI18n } from "alepha/react/i18n";
```

The hook accepts two type parameters for full type safety: the class containing the dictionaries and one of its dictionary keys (to infer available translation keys).

```typescript
function Header() {
  const { tr, l, setLang, lang, languages } = useI18n<App, "en">();

  return (
    <div>
      <h1>{tr("hello")}</h1>
      <p>Current: {lang}</p>
      <select value={lang} onChange={(e) => setLang(e.target.value)}>
        {languages.map((l) => (
          <option key={l} value={l}>{l}</option>
        ))}
      </select>
    </div>
  );
}
```

### tr(key, options?)

Translate a key. Returns the translated string, or the key itself if not found.

```typescript
tr("hello")
// "Hello"

tr("welcome", { args: ["Alice"] })
// "Welcome, Alice"

tr("missing_key", { default: "Fallback text" })
// "Fallback text"
```

**Options:**

| Option    | Type       | Description                                    |
|-----------|------------|------------------------------------------------|
| `args`    | `string[]` | Positional arguments for `$1`, `$2`, etc.      |
| `default` | `string`   | Fallback if the key is not found.              |

Fallback behavior: if the key is not found in the current language, the fallback language (`"en"` by default) is checked. If still not found, the raw key string is returned.

### l(value, options?)

Localize a value (date, number, or error) according to the current locale.

**Number formatting:**

```typescript
l(1234.56)
// "1,234.56" (en) / "1 234,56" (fr)

l(1234.56, { number: { style: "currency", currency: "USD" } })
// "$1,234.56"

l(0.85, { number: { style: "percent" } })
// "85%"
```

Uses `Intl.NumberFormat` under the hood. The `number` option accepts standard `Intl.NumberFormatOptions`.

**Date formatting:**

```typescript
l(new Date())
// "2/7/2026" (en) / "07/02/2026" (fr)

l(new Date(), { date: "LLL" })
// "February 7, 2026 10:30 AM" (dayjs format string)

l(new Date(), { date: "fromNow" })
// "2 hours ago"

l(new Date(), { date: { year: "numeric", month: "long", day: "numeric" } })
// "February 7, 2026" (Intl.DateTimeFormatOptions)

l(new Date(), { date: "LLL", timezone: "America/New_York" })
// Formatted in Eastern time
```

The `date` option accepts:
- A dayjs format string (e.g., `"LLL"`, `"YYYY-MM-DD"`, `"dddd, MMMM D YYYY"`)
- `"fromNow"` for relative time
- `Intl.DateTimeFormatOptions` for native formatting

The `timezone` option accepts IANA timezone names.

**TypeBox error localization:**

```typescript
l(typeBoxError)
// Localized validation error message
```

### setLang(lang)

Switch the current language. On the browser, this:
1. Loads the new language's dictionaries if not already loaded
2. Sets a `lang` cookie (persists for 1 year)
3. Updates the store, causing all `useI18n` consumers to re-render

```typescript
setLang("fr")
```

### lang

The current language code string.

### languages

Array of all available language codes, derived from registered dictionaries.

## Localize Component

A component wrapper around `l()` for inline use in JSX:

```typescript
import { Localize } from "alepha/react/i18n";

<Localize value={new Date()} date="LLL" />
<Localize value={1234.56} number={{ style: "currency", currency: "EUR" }} />
<Localize value={new Date()} date="fromNow" timezone="Europe/Paris" />
```

**Props:**

| Prop       | Type                                  | Description                     |
|------------|---------------------------------------|---------------------------------|
| `value`    | `string \| number \| Date \| DateTime \| TypeBoxError` | The value to localize. |
| `number`   | `Intl.NumberFormatOptions`            | Number formatting options.      |
| `date`     | `string \| Intl.DateTimeFormatOptions` | Date formatting options.       |
| `timezone` | `string`                              | IANA timezone name.             |

## SSR Language Detection

On the server, the language is resolved on each request via a server hook, so
SSR renders use the correct language. The priority is:

1. The `lang` cookie value (set by `setLang`) — a manually-selected language
   always wins.
2. The `Accept-Language` request header — used only for first-time visitors
   (no cookie), and only when the detected language is actually registered. A
   region-qualified header like `fr-FR` matches an exact registration first,
   then its base language (`fr`).
3. The configured fallback language (`"en"` by default).

Because the cookie takes precedence, autodetection never overrides a choice the
user made explicitly. To always start in the fallback language regardless of the
browser's preferred language, disable it with `autoDetect` (see below).

## Configuration

The fallback language defaults to `"en"`. It can be changed on the
`I18nProvider`:

```typescript
const i18n = alepha.inject(I18nProvider);
i18n.options.fallbackLang = "es";
```

`Accept-Language` autodetection is on by default. Disable it to always start in
the fallback language for first-time visitors:

```typescript
i18n.options.autoDetect = false;
```
