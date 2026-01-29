# Localization

Your app works great. In English. Now product wants French, German, and Japanese by next quarter.

Alepha's i18n system handles translations, date formatting, number formatting, and language switching. No external libraries to configure. No build-time extraction. Just define your strings and use them.

## Defining Translations

Use `$dictionary` to register translations. Each dictionary is a language:

```typescript
import { $dictionary } from "alepha/react/i18n";

class I18n {
  en = $dictionary({
    lang: "en",
    lazy: async () => ({
      default: {
        "header.title": "My App",
        "header.login": "Sign In",
        "header.logout": "Log Out",
        "greeting": "Hello, $1!",
      },
    }),
  });

  // even better with dynamic imports
  fr = $dictionary({
    lazy: () => import("./locales/fr.ts"),
  });
}
```

The property name (`en`, `fr`) becomes the language code by default. Override with the `lang` option if needed.

### Why Lazy Loading?

Each `$dictionary` is lazy-loaded **on demand**. If a user's language is French, only the French dictionary is downloaded. English stays on the server.

This matters when you have 20 languages and 500 translation keys. Instead of shipping a 200KB JSON blob with every language, users download only what they need — typically 10-15KB for their language.

When the user switches languages, Alepha fetches the new dictionary automatically. Already-loaded dictionaries are cached, so switching back is instant.

### String Interpolation

Use `$1`, `$2`, etc. for dynamic values:

```typescript
{
  "greeting": "Hello, $1!",
  "items.count": "You have $1 items in your cart",
  "transfer": "Transfer $1 to $2",
}
```

## Using Translations

The `useI18n` hook gives you access to translations:

```tsx
import { useI18n } from "alepha/react/i18n";

const Header = () => {
  const { tr } = useI18n<I18n, "en">(); // <- weird syntax

  return (
    <header>
      <h1>{tr("header.title")}</h1>
      <button>{tr("header.login")}</button>
    </header>
  );
};
```

The generic parameters `<I18n, "en">` give you autocomplete for translation keys. The second parameter is your default language — it's used for type inference.

### With Arguments

Pass dynamic values using the `args` option:

```tsx
const Greeting = ({ name }: { name: string }) => {
  const { tr } = useI18n<I18n, "en">();

  return <p>{tr("greeting", { args: [name] })}</p>;
  // "Hello, John!" or "Bonjour, John !"
};
```

### Fallback Values

If a key is missing, provide a default:

```tsx
{tr("some.missing.key", { default: "Fallback text" })}
```

If no translation exists, the key itself is returned. Useful for spotting missing translations in development.

## Switching Languages

The i18n provider exposes `setLang` and `lang`:

```tsx
import { useI18n } from "alepha/react/i18n";

const LanguageSwitcher = () => {
  const { lang, setLang, languages } = useI18n<I18n, "en">();

  return (
    <select value={lang} onChange={(e) => setLang(e.target.value)}>
      {languages.map((code) => (
        <option key={code} value={code}>
          {code.toUpperCase()}
        </option>
      ))}
    </select>
  );
};
```

Language preference is stored in a cookie. Users get their preferred language on return visits.

### SSR-Friendly

Here's the thing most i18n libraries get wrong: they store the language in localStorage or React state. That means the server renders in the default language, then the client hydrates and flashes to the correct language. Ugly.

Alepha stores the language in a **cookie**. The server reads it on every request and renders the page in the correct language from the start. No flash. No hydration mismatch. The user sees their language immediately, even before JavaScript loads.

## Localizing Values

The `l()` function formats dates, numbers, and errors according to the current locale:

```tsx
const { l } = useI18n<I18n, "en">();

// Numbers
l(1234.56)                              // "1,234.56" (en) or "1 234,56" (fr)
l(0.75, { number: { style: "percent" }}) // "75%"
l(99.99, { number: { style: "currency", currency: "EUR" }}) // "€99.99"

// Dates
l(new Date())                           // "1/15/2024" (en) or "15/01/2024" (fr)
l(new Date(), { date: "YYYY-MM-DD" })   // "2024-01-15"
l(new Date(), { date: "MMMM D, YYYY" }) // "January 15, 2024"
l(new Date(), { date: "fromNow" })      // "2 hours ago"

// With timezone
l(new Date(), { date: "HH:mm", timezone: "America/New_York" })
```

### Date Format Options

The `date` option accepts:

| Format | Example Output |
|--------|----------------|
| `"fromNow"` | "2 hours ago", "in 3 days" |
| `"YYYY-MM-DD"` | "2024-01-15" |
| `"MMMM D, YYYY"` | "January 15, 2024" |
| `"LLL"` | "January 15, 2024 2:30 PM" |
| `"dddd"` | "Monday" |
| Intl options | `{ dateStyle: "full" }` |

Alepha uses dayjs under the hood. See the [dayjs format docs](https://day.js.org/docs/en/display/format) for all options.

## Real-World Example

Here's a complete i18n setup:

```typescript
// src/web/app/services/I18n.ts
import { $dictionary } from "alepha/react/i18n";

export class I18n {
  en = $dictionary({
    lazy: async () => ({
      default: {
        "app.name": "Task Manager",

        "nav.home": "Home",
        "nav.tasks": "Tasks",
        "nav.settings": "Settings",

        "tasks.empty": "No tasks yet. Create one!",
        "tasks.count": "$1 tasks",
        "tasks.create": "New Task",
        "tasks.delete.confirm": "Delete this task?",

        "settings.language": "Language",
        "settings.theme": "Theme",
        "settings.save": "Save Changes",

        "common.cancel": "Cancel",
        "common.confirm": "Confirm",
        "common.loading": "Loading...",
      },
    }),
  });

  fr = $dictionary({
    lazy: async () => ({
      default: {
        "app.name": "Gestionnaire de Tâches",

        "nav.home": "Accueil",
        "nav.tasks": "Tâches",
        "nav.settings": "Paramètres",

        "tasks.empty": "Aucune tâche. Créez-en une !",
        "tasks.count": "$1 tâches",
        "tasks.create": "Nouvelle Tâche",
        "tasks.delete.confirm": "Supprimer cette tâche ?",

        "settings.language": "Langue",
        "settings.theme": "Thème",
        "settings.save": "Enregistrer",

        "common.cancel": "Annuler",
        "common.confirm": "Confirmer",
        "common.loading": "Chargement...",
      },
    }),
  });
}
```

Use it in components:

```tsx
import { useI18n } from "alepha/react/i18n";
import type { I18n } from "../services/I18n";

const TaskList = ({ tasks }: { tasks: Task[] }) => {
  const { tr, l } = useI18n<I18n, "en">();

  if (tasks.length === 0) {
    return <p>{tr("tasks.empty")}</p>;
  }

  return (
    <div>
      <h2>{tr("tasks.count", { args: [String(tasks.length)] })}</h2>
      {tasks.map((task) => (
        <div key={task.id}>
          <span>{task.title}</span>
          <span>{l(task.createdAt, { date: "fromNow" })}</span>
        </div>
      ))}
    </div>
  );
};
```

## Tips

1. **Use namespaced keys** — `"header.login"` beats `"loginButton"`. Easier to find and organize.
2. **Keep translations flat** — Nested objects aren't supported. Use dot notation in keys.
3. **Type your i18n class** — The `useI18n<I18n, "en">()` generic gives you autocomplete and catches typos.
4. **Lazy load everything** — Translations are loaded on demand. Don't inline them.
5. **Test with a fake language** — Add a "pseudo" locale that wraps strings in brackets: `"[Login]"`. Missing translations become obvious.

Internationalization is tedious. But at least Alepha makes the plumbing invisible.
