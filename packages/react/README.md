# Alepha React

Build server-side rendered (SSR) or single-page React applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/react
```
## Module

Provides full-stack React development with declarative routing, server-side rendering, and client-side hydration.

The React module enables building modern React applications using the `$page` descriptor on class properties.
It delivers seamless server-side rendering, automatic code splitting, and client-side navigation with full
type safety and schema validation for route parameters and data.

**Key Features:**
- Declarative page definition with `$page` descriptor
- Server-side rendering (SSR) with automatic hydration
- Type-safe routing with parameter validation
- Schema-based data resolution and validation
- SEO-friendly meta tag management
- Automatic code splitting and lazy loading
- Client-side navigation with browser history

**Basic Usage:**
```ts
import { Alepha, run, t } from "alepha";
import { AlephaReact, $page } from "alepha/react";

class AppRoutes {
  // Home page
  home = $page({
    path: "/",
    component: () => (
      <div>
        <h1>Welcome to Alepha</h1>
        <p>Build amazing React applications!</p>
      </div>
    ),
  });

  // About page with meta tags
  about = $page({
    path: "/about",
    head: {
      title: "About Us",
      description: "Learn more about our mission",
    },
    component: () => (
      <div>
        <h1>About Us</h1>
        <p>Learn more about our mission.</p>
      </div>
    ),
  });
}

const alepha = Alepha.create()
  .with(AlephaReact)
  .with(AppRoutes);

run(alepha);
```

**Dynamic Routes with Parameters:**
```tsx
class UserRoutes {
  userProfile = $page({
    path: "/users/:id",
    schema: {
      params: t.object({
        id: t.string(),
      }),
    },
    resolve: async ({ params }) => {
      // Fetch user data server-side
      const user = await getUserById(params.id);
      return { user };
    },
    head: ({ user }) => ({
      title: `${user.name} - Profile`,
      description: `View ${user.name}'s profile`,
    }),
    component: ({ user }) => (
      <div>
        <h1>{user.name}</h1>
        <p>Email: {user.email}</p>
      </div>
    ),
  });

  userSettings = $page({
    path: "/users/:id/settings",
    schema: {
      params: t.object({
        id: t.string(),
      }),
    },
    component: ({ params }) => (
      <UserSettings userId={params.id} />
    ),
  });
}
```

**Static Generation:**
```tsx
class BlogRoutes {
  blogPost = $page({
    path: "/blog/:slug",
    schema: {
      params: t.object({
        slug: t.string(),
      }),
    },
    static: {
      entries: [
        { params: { slug: "getting-started" } },
        { params: { slug: "advanced-features" } },
        { params: { slug: "deployment" } },
      ],
    },
    resolve: ({ params }) => {
      const post = getBlogPost(params.slug);
      return { post };
    },
    component: ({ post }) => (
      <article>
        <h1>{post.title}</h1>
        <div>{post.content}</div>
      </article>
    ),
  });
}
```

## API Reference

### Descriptors

#### $page()

Main descriptor for defining a React route in the application.
