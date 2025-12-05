# State Management

Every React developer has been there: Redux boilerplate hell, Context prop drilling nightmares, or Zustand stores that don't survive SSR.

Alepha has a simple state system built around two primitives: `$atom` for defining state, and `$use` for consuming it.

## The Problem With Traditional State

In Next.js or Remix, sharing state between server and client is painful:

```typescript
// next.js way - manual serialization, hydration mismatches
export async function getServerSideProps() {
  const user = await getUser();
  return { props: { user } }; // hope it serializes correctly
}
```

In Redux, you need a store, reducers, actions, and a hydration strategy. That's four files minimum for "I want to share some data."

## Atoms: State Made Simple

An atom is a piece of state with a schema, a name, and optionally a default value.

```typescript
import { $atom } from "alepha";
import { t } from "alepha";

const userPreferences = $atom({
  name: "user.preferences",
  schema: t.object({
    theme: t.enum(["light", "dark"]),
    language: t.text(),
    notifications: t.boolean(),
  }),
  default: {
    theme: "light",
    language: "en",
    notifications: true,
  },
});
```

That's it. No store. No provider. No boilerplate.

## Reading State with `$use`

In your services, use `$use` to get the current value:

```typescript
class ThemeService {
  // reactive reference to the atom
  prefs = $use(userPreferences);

  isDarkMode() {
    return this.prefs.theme === "dark";
  }
}
```

In React components, the value updates automatically:

```tsx
const ThemeToggle = () => {
  const prefs = $use(userPreferences);

  return (
    <button onClick={() => prefs.theme = prefs.theme === "dark" ? "light" : "dark"}>
      Current: {prefs.theme}
    </button>
  );
};
```

Yes, you can mutate directly. No action dispatching. No reducers.

## SSR Hydration (It Just Works)

Here's where Alepha shines. Atoms automatically serialize on the server and hydrate on the client.

```tsx
// server: atom value is serialized into HTML
// client: atom hydrates with server value, no flash of wrong content

const Dashboard = () => {
  const prefs = $use(userPreferences);

  // no hydration mismatch, no loading state
  return <div className={prefs.theme}>...</div>;
};
```

Compare this to Next.js where you'd need `useEffect` to avoid hydration errors, or Redux where you manually rehydrate the store.

## Writing State

You can set atom values from anywhere:

```typescript
// direct mutation (in components or services)
prefs.theme = "dark";

// or get the alepha instance and use setState
alepha.state(userPreferences, { theme: "dark" });
```

## Persistence

Atoms can persist to localStorage, cookies, or even Redis:

```typescript
const sessionData = $atom({
  name: "session",
  schema: t.object({
    token: t.optional(t.text()),
    expiresAt: t.optional(t.number()),
  }),
  persist: "localStorage", // survives page refresh
});
```

Options: `"localStorage"`, `"sessionStorage"`, `"cookie"`, or a custom adapter.

## When To Use Atoms vs Props

| Scenario | Use |
|----------|-----|
| User preferences, theme, language | `$atom` |
| Authentication state | `$atom` |
| Page-specific data from `resolve` | Props via `$page` |
| Form state | `useForm` hook |
| Temporary UI state (modal open) | `useState` |

Atoms are for **global state** that multiple components need. Don't atom-ify everything.

## Comparison: Redux vs Jotai vs Alepha

**Redux:**
```typescript
// store.ts, userSlice.ts, actions.ts, selectors.ts...
// 100+ lines for user preferences
const dispatch = useDispatch();
dispatch(setTheme("dark"));
```

**Jotai:**
```typescript
// simpler, but no SSR hydration story
const themeAtom = atom("light");
const [theme, setTheme] = useAtom(themeAtom);
```

**Alepha:**
```typescript
// type-safe, SSR-ready, one file
const prefs = $use(userPreferences);
prefs.theme = "dark";
```

## Advanced: Computed Values

Need derived state? Just compute it:

```typescript
class AppState {
  prefs = $use(userPreferences);

  // computed on access, no memoization needed
  get cssClass() {
    return this.prefs.theme === "dark" ? "dark-mode" : "light-mode";
  }
}
```

## Debugging

Atoms show up in Alepha DevTools (`/devtools`). You can inspect current values, see which components are subscribed, and even modify state live.

No Redux DevTools extension needed. No setup. It's built in.

---

State management doesn't have to be complicated. Define your shape with `$atom`, read it with `$use`, and let Alepha handle the rest.
