# State Management

You know the drill. You fetch data on the server, pass it through props, and pray it survives hydration. Or you set up Redux with 47 files just to share a user object.

Alepha has a simpler approach: **atoms** for defining state, **useStore** for consuming it in React, and automatic SSR hydration. No providers, no reducers, no boilerplate.

> **Note:** `useStore` is part of `@alepha/react` (core) and works with or without the router.

## Defining State with `$atom`

An atom is a piece of state with a name and a schema. The schema gives you type safety and validation.

```typescript
// atoms/currentProjectAtom.ts
import { $atom, t } from "alepha";

export const currentProjectAtom = $atom({
  name: "current_project",
  schema: t.optional(t.object({
    id: t.integer(),
    title: t.text(),
    description: t.optional(t.text()),
  })),
});
```

That's your entire state definition. No store setup. No provider wrapping your app.

### Reusing Entity Schemas

If you have database entities, you can reuse their schemas directly:

```typescript
import { $atom, t } from "alepha";
import { projects } from "../api/entities/projects.ts";

// The atom schema matches your database entity
export const currentProjectAtom = $atom({
  name: "current_project",
  schema: t.optional(projects.schema),
});
```

One schema definition, used everywhere: database, API validation, and frontend state.

### Arrays of Items

For lists, wrap the schema in `t.array()`:

```typescript
import { $atom, t } from "alepha";
import { projects } from "../api/entities/projects.ts";

export const userProjectsAtom = $atom({
  name: "user_projects",
  schema: t.optional(t.array(projects.schema)),
});
```

## Reading State with `useStore`

In React components, use the `useStore` hook. It returns a tuple like `useState`: the current value and a setter function.

```tsx
import { useStore } from "@alepha/react";
import { userProjectsAtom } from "../atoms/userProjectsAtom.ts";

const ProjectList = () => {
  const [projects = []] = useStore(userProjectsAtom);

  return (
    <ul>
      {projects.map(project => (
        <li key={project.id}>{project.title}</li>
      ))}
    </ul>
  );
};
```

The component re-renders automatically when the atom value changes. No subscriptions to manage.

### Default Values

If the atom might be `undefined`, provide a fallback:

```tsx
const [projects = []] = useStore(userProjectsAtom);
// projects is never undefined, defaults to []
```

### Updating State from Components

The second element of the tuple is a setter:

```tsx
const ThemeToggle = () => {
  const [theme, setTheme] = useStore(themeAtom);

  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      Current: {theme}
    </button>
  );
};
```

## Setting State from Page Loading

The real power comes when you combine atoms with `$page` loading. Load data on the server, put it in an atom, and it's instantly available to all components.

```typescript
import { $page } from "@alepha/react/router";
import { $inject, Alepha } from "alepha";
import { $client } from "alepha/server/links";
import { currentProjectAtom } from "./atoms/currentProjectAtom.ts";
import type { ProjectController } from "./api/ProjectController.ts";

class AppRouter {
  alepha = $inject(Alepha);
  projectApi = $client<ProjectController>();

  project = $page({
    path: "/p/:projectId",
    lazy: () => import("./components/ProjectView.tsx"),
    loader: async ({ params }) => {
      // Fetch on server (or client on navigation)
      const project = await this.projectApi.getProjectById({
        params: { id: params.projectId },
      });

      // Put it in the atom
      this.alepha.store.set(currentProjectAtom, project);

      // Also return for props if needed
      return { project };
    },
    onLeave: () => {
      // Clean up when leaving the page
      this.alepha.store.set(currentProjectAtom, undefined);
    },
  });
}
```

Now any component under this route can access the project without prop drilling:

```tsx
// Deep in the component tree - no props needed
const ProjectHeader = () => {
  const [project] = useStore(currentProjectAtom);

  return <h1>{project?.title}</h1>;
};
```

## Updating State After Actions

When the user creates, updates, or deletes something, update the relevant atoms:

```tsx
import { useAlepha, useClient, useStore } from "@alepha/react";
import { useRouter } from "@alepha/react/router";
import { useForm } from "@alepha/react/form";
import { userProjectsAtom } from "../atoms/userProjectsAtom.ts";
import type { ProjectController } from "../api/ProjectController.ts";

const ProjectCreate = () => {
  const alepha = useAlepha();
  const client = useClient<ProjectController>();
  const router = useRouter();

  const form = useForm({
    schema: t.object({
      title: t.text(),
      description: t.optional(t.text()),
    }),
    handler: async (body) => {
      // Create the project
      const project = await client.createProject({ body });

      // Update the atom with the new project
      alepha.store.set(userProjectsAtom, [
        ...(alepha.store.get(userProjectsAtom) || []),
        project,
      ]);

      // Navigate to the new project
      await router.go("project", {
        params: { projectId: String(project.id) },
      });
    },
  });

  return (
    <form onSubmit={form.onSubmit}>
      {/* form fields */}
    </form>
  );
};
```

The project list component will re-render automatically with the new project included.

## Accessing State Outside React

Sometimes you need to read or write atoms outside of React components—in services, event handlers, or page resolution.

### Using `alepha.store`

```typescript
// Read
const project = alepha.store.get(currentProjectAtom);

// Write
alepha.store.set(currentProjectAtom, newProject);

// Read raw key (without atom)
const user = alepha.store.get("alepha.server.request.user");
```

### In Services with `$use`

For class-based services, use the `$use` primitive for reactive access:

```typescript
import { $use } from "alepha";

class ThemeService {
  prefs = $use(userPreferencesAtom);

  isDarkMode() {
    return this.prefs.theme === "dark";
  }
}
```

The `prefs` property updates automatically when the atom changes.

## SSR Hydration

Here's the magic: atoms serialize on the server and hydrate on the client automatically.

```
1. Server: resolve() fetches data, sets atom
2. Server: React renders with atom value
3. Server: Atom state serialized into HTML
4. Client: Page loads, atom hydrates from HTML
5. Client: React renders with same value - no flash!
```

No hydration mismatches. No `useEffect` hacks. No loading spinners for data you already have.

## Organizing Atoms

Keep atoms in a dedicated folder, one file per atom:

```
src/
├── atoms/
│   ├── currentProjectAtom.ts
│   ├── currentTaskAtom.ts
│   ├── userProjectsAtom.ts
│   └── userPreferencesAtom.ts
├── components/
└── api/
```

Each atom file is simple:

```typescript
// atoms/currentTaskAtom.ts
import { $atom, t } from "alepha";
import { tasks } from "../api/entities/tasks.ts";

export const currentTaskAtom = $atom({
  name: "current_task",
  schema: t.optional(tasks.schema),
});
```

## When to Use What

| Scenario | Solution |
|----------|----------|
| Data shared across many components | `$atom` + `useStore` |
| Current page/route data | `$atom` set in `loader()` |
| User preferences, theme | `$atom` with default value |
| Authentication state | `$atom` (Alepha handles this internally) |
| Form input | `useForm` hook |
| Local UI state (modal open, tab index) | `useState` |
| Derived/computed values | Just compute in render or use a getter |

## Quick Reference

```typescript
// Define an atom
const myAtom = $atom({
  name: "unique_name",
  schema: t.object({ ... }),
  default: { ... }, // optional
});

// React component - read & write
const [value, setValue] = useStore(myAtom);

// React component - read only with default
const [value = defaultValue] = useStore(myAtom);

// Outside React - read
const value = alepha.store.get(myAtom);

// Outside React - write
alepha.store.set(myAtom, newValue);

// In services - reactive access
class MyService {
  data = $use(myAtom);
}
```

State management without the ceremony. Define your shape, use it everywhere, let Alepha handle the plumbing.

---

Previous: [Routing](./2-routing.md) | Next: [Head & SEO](./4-head-and-seo.md)
