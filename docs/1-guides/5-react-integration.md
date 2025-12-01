# React Integration

Alepha isn't just a backend framework. It's a full-stack framework. We treat the frontend as just another part of your application graph.

## The `$page` Primitive

In frameworks like Next.js or Remix, you create files in a `pages/` directory. In Alepha, you define pages as properties on a class, just like API endpoints.

Why? Because it allows Type-Safe linkage between your backend data fetching and your frontend components.

```tsx
// src/app/router.ts
import { $page } from "@alepha/react";
import { t } from "alepha";

export class AppRouter {

  // Define a route
  dashboard = $page({
    path: "/dashboard",

    // Validation for URL Query Params
    schema: {
      query: t.object({
        filter: t.optional(t.text())
      })
    },

    // Server-Side Data Fetching (The "Loader")
    // This runs on the server.
    resolve: async ({ query }) => {
      // You can inject backend services here!
      const stats = await db.stats.get(query.filter);
      return { stats };
    },

    // The React Component
    // Props are typed automatically from the resolve return type
    component: ({ stats }) => {
      return <div>Stats: {stats.count}</div>
    }
  });
}
```

## Hooks

We provide hooks to interact with the framework from inside your React components.

*   `useAlepha()`: Get access to the DI container in the client.
*   `useAction()`: Wrapper around async functions to handle loading/error states.
*   `useForm()`: Manage form state, validation, and submission based on TypeBox schemas.

### Forms Example

Since we share schemas, building forms is trivial.

```tsx
import { useForm } from "@alepha/react/form";
import { TypeForm } from "@alepha/ui";

const MyComponent = () => {
  const form = useForm({
    schema: userSchema, // Reuse the same schema from your DB/API!
    handler: async (values) => {
      await api.users.create(values);
    }
  });

  // Renders a full form with labels, validation, and error handling
  return <TypeForm form={form} />;
};
```

## Server-Side Rendering (SSR)

Alepha handles SSR out of the box.
1.  The server matches the URL to a `$page`.
2.  It runs the `resolve` function to get data.
3.  It renders the React component string.
4.  It sends HTML to the browser.
5.  It "hydrates" the React app on the client side.

You don't need to configure Babel, Webpack, or Vite manually. `alepha dev` and `alepha build` handle the complexity.
