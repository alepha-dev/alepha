# React Integration

Alepha isn't just a backend framework. It's a full-stack framework. We treat the frontend as just another part of your application graph.

## Installation

The `@alepha/react` package is **not bundled** with the main `alepha` package. It's a separate extension that you need to install explicitly.

**Recommended:** Use the CLI to scaffold a React-ready project:

```bash
npx alepha init --react
```

This is the preferred method because it:
- Installs `@alepha/react` and its peer dependencies
- Creates the required `index.html` entry point
- Sets up `main.browser.ts` for client-side hydration
- Configures Vite for SSR builds

**Alternative:** If you're adding React to an existing Alepha project:

```bash
npm install @alepha/react
```

Note: You'll need to manually create `index.html` and configure the browser entry point.

## The `$page` Primitive

In frameworks like Next.js or Remix, you create files in a `pages/` directory. In Alepha, you define pages as properties on a class, just like API endpoints.

Why? Because it allows Type-Safe linkage between your backend data fetching and your frontend components.

```tsx
import { $page } from "@alepha/react";
import { t } from "alepha";

export class AppRouter {
  home = $page({
    path: "/",
    component: () => <div>Welcome!</div>
  });

  dashboard = $page({
    path: "/dashboard",
    schema: {
      query: t.object({
        filter: t.optional(t.text())
      })
    },
    // Server-Side Data Fetching (runs on the server)
    resolve: async ({ query }) => {
      const stats = await db.stats.get(query.filter);
      return { stats };
    },
    // Props are typed automatically from resolve
    component: ({ stats }) => {
      return <div>Stats: {stats.count}</div>
    }
  });

  userProfile = $page({
    path: "/users/:id",
    schema: {
      params: t.object({ id: t.text() })
    },
    resolve: async ({ params }) => {
      return { user: await db.users.findById(params.id) };
    },
    component: ({ user }) => <UserCard user={user} />
  });
}
```

## Routing & Navigation

### The `useRouter` Hook

Use `useRouter<T>()` with your App class as a type parameter for fully type-safe navigation.

```tsx
import { useRouter } from "@alepha/react";

const Navigation = () => {
  const router = useRouter<AppRouter>();

  return (
    <div>
      {/* Type-safe navigation by page name */}
      <button onClick={() => router.go("home")}>Home</button>
      <button onClick={() => router.go("dashboard")}>Dashboard</button>

      {/* With params */}
      <button onClick={() => router.go("userProfile", { params: { id: "123" } })}>
        View User
      </button>

      {/* Or by raw path */}
      <button onClick={() => router.go("/settings")}>Settings</button>

      {/* History navigation */}
      <button onClick={() => router.back()}>Back</button>
      <button onClick={() => router.forward()}>Forward</button>
    </div>
  );
};
```

### Generating Paths with `router.path()`

Use `router.path()` to generate type-safe URLs from page names. This is useful for `<a>` tags or any component that needs an href.

```tsx
const UserNav = () => {
  const router = useRouter<AppRouter>();

  return (
    <nav>
      {/* Generate path by page name */}
      <a href={router.path("home")}>Home</a>
      <a href={router.path("dashboard")}>Dashboard</a>

      {/* With params */}
      <a href={router.path("userProfile", { params: { id: "123" } })}>
        View User
      </a>

      {/* With query params */}
      <a href={router.path("dashboard", { query: { filter: "active" } })}>
        Active Users
      </a>
    </nav>
  );
};
```

### Anchor Props with `router.anchor()`

Use `router.anchor()` to get both `href` and `onClick` props for client-side navigation without full page reload.

```tsx
const NavLink = ({ page, children }) => {
  const router = useRouter<AppRouter>();

  // Returns { href, onClick } - handles client-side routing
  return (
    <a {...router.anchor(page)}>
      {children}
    </a>
  );
};

// Usage
<NavLink page="dashboard">Dashboard</NavLink>
<NavLink page="userProfile" params={{ id: "123" }}>Profile</NavLink>
```

### Query Parameters

Access and modify query parameters:

```tsx
const Filters = () => {
  const router = useRouter<AppRouter>();

  // Read current query params
  const { sort, filter } = router.query;

  // Read from URL after redirect
  const redirect = router.query.redirect || "/";

  // Update query params (doesn't reload the page)
  const setSort = (value: string) => {
    router.setQueryParams({ ...router.query, sort: value });
  };

  return (
    <select value={sort} onChange={(e) => setSort(e.target.value)}>
      <option value="name">Name</option>
      <option value="date">Date</option>
    </select>
  );
};
```

### Active State with `useActive`

Use `useActive` to build navigation links that know their active state and handle transitions properly.

```tsx
import { useActive } from "@alepha/react";

const NavLink = ({ href, children }) => {
  const { isActive, isPending, anchorProps } = useActive(href);

  return (
    <a
      {...anchorProps}
      className={isActive ? "active" : isPending ? "loading" : ""}
    >
      {children}
    </a>
  );
};

// With startWith option for nested routes
const SidebarLink = ({ href, children }) => {
  const { isActive, anchorProps } = useActive({ href, startWith: true });

  // isActive is true for /users, /users/123, /users/settings, etc.
  return (
    <a {...anchorProps} className={isActive ? "active" : ""}>
      {children}
    </a>
  );
};
```

The `useActive` hook returns:
*   `isActive`: Whether the current route matches the href.
*   `isPending`: Whether navigation to this route is in progress.
*   `anchorProps`: Props (`href`, `onClick`) for the anchor element with proper client-side navigation.

## Head Management

Control the document `<head>` from anywhere in your component tree.

### Global Head with `$head`

Set default head values for your entire app:

```tsx
import { $head } from "@alepha/react/head";

class App {
  head = $head({
    title: "My SaaS",
    titleSeparator: " | ",
    description: "The best SaaS platform",
    og: {
      image: "/og-image.png",
      type: "website"
    }
  });
}
```

### Dynamic Head with `useHead`

Update the head from any component:

```tsx
import { useHead } from "@alepha/react/head";

const ProductPage = ({ product }) => {
  const [head, setHead] = useHead({
    title: product.name,
    description: product.description,
    og: {
      title: product.name,
      image: product.image
    }
  });

  return <div>{/* ... */}</div>;
};
```

The `useHead` hook returns the current head state and a setter function. Changes are applied immediately on the client and rendered correctly during SSR.

## Internationalization (i18n)

Alepha provides SSR-friendly internationalization out of the box.

### Define Dictionaries with `$dictionary`

```tsx
import { $dictionary } from "@alepha/react/i18n";

class App {
  // Lazy-loaded translations
  en = $dictionary({
    lazy: () => import("./translations/en.ts"),
  });

  fr = $dictionary({
    lazy: () => import("./translations/fr.ts"),
  });
}

// translations/en.ts
export default {
  welcome: "Welcome",
  greeting: "Hello, {name}!",
  items: "{count} items",
};

// translations/fr.ts
export default {
  welcome: "Bienvenue",
  greeting: "Bonjour, {name}!",
  items: "{count} articles",
};
```

### Use Translations with `useI18n`

```tsx
import { useI18n } from "@alepha/react/i18n";

const Greeting = ({ user }) => {
  const { tr, lang, setLang } = useI18n<App, "en">();

  return (
    <div>
      <p>{tr("welcome")}</p>
      <p>{tr("greeting", { name: user.name })}</p>

      {/* Language switcher */}
      <select value={lang} onChange={(e) => setLang(e.target.value)}>
        <option value="en">English</option>
        <option value="fr">Français</option>
      </select>
    </div>
  );
};
```

Translations are:
*   **Lazy-loaded:** Only the current language is loaded, reducing bundle size.
*   **SSR-friendly:** The correct language is rendered on the server.
*   **Type-safe:** Translation keys are checked at compile time.

## Forms (Bonus)

Since we share schemas between backend and frontend, building forms is straightforward.

### The `useForm` Hook

```tsx
import { useForm } from "@alepha/react/form";

const CreateUserForm = () => {
  const form = useForm({
    schema: t.object({
      name: t.text({ minLength: 2 }),
      email: t.email(),
      age: t.integer({ minimum: 18 }),
    }),
    handler: async (values) => {
      await api.users.create(values);
    }
  });

  return (
    <form onSubmit={form.submit}>
      <input {...form.field("name")} placeholder="Name" />
      {form.errors.name && <span>{form.errors.name}</span>}

      <input {...form.field("email")} placeholder="Email" />
      {form.errors.email && <span>{form.errors.email}</span>}

      <input {...form.field("age")} type="number" placeholder="Age" />
      {form.errors.age && <span>{form.errors.age}</span>}

      <button type="submit" disabled={form.loading}>
        {form.loading ? "Saving..." : "Create User"}
      </button>
    </form>
  );
};
```

The form automatically validates against your TypeBox schema before submission.

## Server-Side Rendering (SSR)

Alepha handles SSR out of the box:
1.  The server matches the URL to a `$page`.
2.  It runs the `resolve` function to get data.
3.  It renders the React component to HTML.
4.  It sends HTML to the browser.
5.  It "hydrates" the React app on the client side.

You don't need to configure Babel, Webpack, or Vite manually. `alepha dev` and `alepha build` handle the complexity.
