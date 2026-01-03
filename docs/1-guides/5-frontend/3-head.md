# Head Management

SEO. Social sharing. The stuff that makes marketing people happy and developers groan.

The `@alepha/react/head` module lets you control the document `<head>` from anywhere in your component tree. Title, meta tags, Open Graph, Twitter cards - all type-safe and SSR-friendly.

> **Requires Router:** This module depends on `@alepha/react/router` for SSR rendering of head tags.

## Installation

Head management is a separate module from router:

```typescript
import { AlephaReactHead } from "@alepha/react/head";

const alepha = Alepha.create()
  .with(AlephaReactRouter)  // Required
  .with(AlephaReactHead);   // Add head support
```

Or just use `$head` in your primitives - it auto-loads:

```typescript
import { $module } from "alepha";
import { $page } from "@alepha/react/router";
import { $head } from "@alepha/react/head";

export const AppModule = $module({
  name: "my-app",
  primitives: [$page, $head], // Both auto-load their modules
});
```

## Global Head with `$head`

Set default head values for your entire app:

```tsx
import { $head } from "@alepha/react/head";

class App {
  head = $head({
    title: "My SaaS",
    titleSeparator: " | ",
    description: "The best SaaS platform ever built",
    og: {
      image: "/og-image.png",
      type: "website"
    },
    twitter: {
      card: "summary_large_image",
      site: "@mysaas"
    }
  });
}
```

This becomes the baseline. Every page inherits these values unless overridden.

### Full Options

```typescript
$head({
  // Basic
  title: "Page Title",
  titleSeparator: " | ",        // "Page | Site Name"
  description: "Meta description for SEO",
  keywords: ["saas", "typescript"],
  author: "Your Name",

  // Favicon
  favicon: "/favicon.ico",

  // Open Graph (Facebook, LinkedIn, etc.)
  og: {
    title: "OG Title",          // Falls back to title
    description: "OG Desc",     // Falls back to description
    image: "/og-image.png",
    type: "website",            // website, article, product...
    siteName: "My Site",
  },

  // Twitter Cards
  twitter: {
    card: "summary_large_image", // summary, summary_large_image
    site: "@handle",
    creator: "@author",
  },

  // Canonical URL
  canonical: "https://example.com/page",

  // Robots
  robots: "index, follow",

  // Custom meta tags
  meta: [
    { name: "theme-color", content: "#000000" },
    { property: "custom:tag", content: "value" },
  ],

  // Custom link tags
  link: [
    { rel: "preconnect", href: "https://fonts.googleapis.com" },
  ],
});
```

## Page-Level Head

Override head values per page:

```tsx
import { $page } from "@alepha/react/router";

class AppRouter {
  blog = $page({
    path: "/blog/:slug",
    resolve: async ({ params }) => {
      const post = await db.posts.findBySlug(params.slug);
      return { post };
    },
    // Static head
    head: {
      title: "Blog",
      og: { type: "article" }
    },
    component: BlogPost,
  });

  // Dynamic head based on resolved data
  product = $page({
    path: "/products/:id",
    resolve: async ({ params }) => {
      const product = await db.products.findById(params.id);
      return { product };
    },
    // Function form - receives resolved props
    head: (props) => ({
      title: props.product.name,
      description: props.product.description,
      og: {
        title: props.product.name,
        image: props.product.image,
        type: "product",
      },
    }),
    component: ProductPage,
  });
}
```

### Inheriting from Parent

The head function receives the previous head as second argument:

```tsx
head: (props, previous) => ({
  ...previous,  // Keep parent values
  title: `${props.product.name} | ${previous?.title}`,
}),
```

## Dynamic Head with `useHead`

Update head from any component:

```tsx
import { useHead } from "@alepha/react/head";

const ProductPage = ({ product }) => {
  const [head, setHead] = useHead({
    title: product.name,
    description: product.description,
    og: {
      title: product.name,
      image: product.image,
    }
  });

  // Update when product changes
  useEffect(() => {
    setHead({
      title: product.name,
      description: product.description,
    });
  }, [product]);

  return <div>{/* ... */}</div>;
};
```

### Reading Current Head

The hook returns the current head state:

```tsx
const ProductMeta = () => {
  const [head] = useHead();

  return (
    <div>
      <p>Current title: {head.title}</p>
      <p>Description: {head.description}</p>
    </div>
  );
};
```

## SEO Expander

The `SeoExpander` helper fills in missing values automatically:

```typescript
import { SeoExpander } from "@alepha/react/head";

const expander = new SeoExpander({
  baseUrl: "https://example.com",
  siteName: "My Site",
  defaultImage: "/default-og.png",
});

// Input: minimal head
const input = {
  title: "Hello World",
  description: "A blog post",
};

// Output: fully expanded for SEO
const output = expander.expand(input);
// {
//   title: "Hello World",
//   description: "A blog post",
//   og: {
//     title: "Hello World",
//     description: "A blog post",
//     image: "https://example.com/default-og.png",
//     siteName: "My Site",
//     type: "website",
//   },
//   twitter: {
//     card: "summary_large_image",
//     title: "Hello World",
//     description: "A blog post",
//     image: "https://example.com/default-og.png",
//   },
//   canonical: "https://example.com/current-path",
// }
```

## How It Works

1. **Server:** `$head` and page heads merge into final state
2. **Server:** React renders, head tags injected into HTML `<head>`
3. **Client:** `useHead` updates sync to document.title and meta tags
4. **Navigation:** Head updates on route change, no flash

The head is part of the router state, so it survives hydration cleanly.

## Common Patterns

### Blog Post

```tsx
head: (props) => ({
  title: props.post.title,
  description: props.post.excerpt,
  og: {
    type: "article",
    image: props.post.coverImage,
  },
  meta: [
    { property: "article:published_time", content: props.post.publishedAt },
    { property: "article:author", content: props.post.author.name },
  ],
}),
```

### E-commerce Product

```tsx
head: (props) => ({
  title: `${props.product.name} - Buy Now`,
  description: props.product.shortDescription,
  og: {
    type: "product",
    image: props.product.images[0],
  },
  meta: [
    { property: "product:price:amount", content: props.product.price },
    { property: "product:price:currency", content: "USD" },
  ],
}),
```

### User Profile

```tsx
head: (props) => ({
  title: `${props.user.name} (@${props.user.username})`,
  description: props.user.bio,
  og: {
    type: "profile",
    image: props.user.avatar,
  },
}),
```

## Quick Reference

```typescript
// Define global head
const head = $head({
  title: "My App",
  description: "...",
  og: { ... },
});

// Page-level head (static)
$page({
  head: { title: "Page" },
});

// Page-level head (dynamic)
$page({
  head: (props) => ({ title: props.data.name }),
});

// Component-level head
const [head, setHead] = useHead({ title: "Dynamic" });

// Read current head
const [head] = useHead();
```

---

Previous: [State Management](./2-state-management.md) | Next: [Forms](./4-form.md)
