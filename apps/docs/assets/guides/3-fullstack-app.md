## Building a Full-Stack Application

Ready to level up? This guide will show you how to build a complete full-stack application with Alepha,
featuring server-side rendering (SSR), client-side navigation, and type-safe routing.

We'll transform a basic server into a modern web application with React components and dynamic pages.

### Prerequisites

Make sure you've completed the [Getting Started](/docs/getting-started) guide first. You'll need:

- Node.js 22+ or the latest version of Bun
- A basic Alepha server from the previous guide

### 1. Install Additional Dependencies

We need to add React and the Alepha React package for full-stack functionality.

```bash
npm install react
npm install -D @types/react @vitejs/plugin-react vite
```

### 2. Project Structure

Let's organize our project with the following structure:

```
my-app/
├── src/
│   ├── components/
│   │   ├── Layout.tsx
│   │   ├── Home.tsx
│   │   └── About.tsx
│   ├── styles.css
│   ├── AppRouter.ts
│   ├── index.server.ts
│   └── index.browser.ts
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

### 3. Create the App Router

The `AppRouter` is the heart of your full-stack application. It defines all your pages using `$page` descriptors and handles routing, data fetching, and error handling.

**`src/AppRouter.ts`**
```typescript
import { $page } from "@alepha/react";
import { t } from "alepha";

export class AppRouter {
  // Root layout page that wraps all other pages
  layout = $page({
    lazy: () => import("./components/Layout.tsx"),
    children: () => [this.home, this.about],
  });

  // Home page with static generation for performance
  home = $page({
    path: "/",
    static: true,
    lazy: () => import("./components/Home.tsx"),
    resolve: async () => {
      // Fetch data on the server before rendering
      const message = "Welcome to your full-stack Alepha app!";
      const timestamp = new Date().toISOString();

      return {
        message,
        timestamp,
      };
    },
  });

  // About page with URL parameters
  about = $page({
    path: "/about/:section?",
    schema: {
      params: t.object({
        section: t.optional(t.string()),
      }),
      query: t.object({
        detailed: t.optional(t.boolean()),
      }),
    },
    lazy: () => import("./components/About.tsx"),
    resolve: async ({ params, query }) => {
      const section = params.section || "general";
      const isDetailed = query.detailed || false;

      return {
        section,
        isDetailed,
        content: `This is the ${section} section of our about page.`,
      };
    },
  });
}
```

### 4. Create React Components

Let's create clean React components with simple CSS styling.

**`src/components/Layout.tsx`**
```tsx
import { Link, NestedView, useRouterEvents } from "@alepha/react";
import { useState } from "react";

const Layout = () => {
  return (
    <div className="app">
      <header>
        <h1>My Alepha App</h1>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/about">About</Link>
          <Link href="/about/team">Team</Link>
        </nav>
      </header>

      <main>
        <NestedView />
      </main>
    </div>
  );
};

export default Layout;
```

**`src/components/Home.tsx`**
```tsx
import { Link } from "@alepha/react";

interface HomeProps {
  message: string;
  timestamp: string;
}

export default function Home({ message, timestamp }: HomeProps) {
  return (
    <div>
      <h1>Full-Stack Alepha Application</h1>
      <p>{message}</p>
      <p>Rendered at: {new Date(timestamp).toLocaleString()}</p>

      <h2>Features</h2>
      <ul>
        <li>Server-Side Rendering (SSR)</li>
        <li>Type-safe routing with $page descriptors</li>
        <li>Automatic code splitting</li>
        <li>Data fetching with resolve functions</li>
        <li>Static generation for performance</li>
      </ul>

      <h2>Try Navigation</h2>
      <nav>
        <Link href="/about">About page</Link>
        <Link href="/about/team?detailed=true">Team section (detailed)</Link>
        <Link href="/nonexistent">404 page</Link>
      </nav>
    </div>
  );
}
```

**`src/components/About.tsx`**
```tsx
import { Link } from "@alepha/react";

interface AboutProps {
  section: string;
  isDetailed: boolean;
  content: string;
}

export default function About({ section, isDetailed, content }: AboutProps) {
  return (
    <div>
      <h1>About Our Application</h1>
      <h2>Section: {section}</h2>
      <p>{content}</p>

      {isDetailed && (
        <div style={{ background: "#f0f0f0", padding: "1rem", margin: "1rem 0" }}>
          <h3>Detailed Information</h3>
          <p>You requested detailed information for the <strong>{section}</strong> section.</p>
          <p>This demonstrates how query parameters can control content visibility.</p>
        </div>
      )}

      <h3>URL Information</h3>
      <p>Current section: <code>{section}</code></p>
      <p>Detailed view: <code>{isDetailed.toString()}</code></p>

      <h3>Try Different URLs</h3>
      <nav>
        <Link href="/about">General section</Link>
        <Link href="/about/team">Team section</Link>
        <Link href="/about/team?detailed=true">Team section (detailed)</Link>
      </nav>
    </div>
  );
}
```

### 5. Create Simple Styles

**`src/styles.css`**
```css
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  margin: 0;
  padding: 20px;
  line-height: 1.6;
}

header {
  background: #f5f5f5;
  padding: 1rem;
  margin-bottom: 2rem;
  border-radius: 8px;
}

nav a {
  color: #0066cc;
  text-decoration: none;
  margin-right: 1rem;
}

nav a:hover {
  text-decoration: underline;
}

footer {
  margin-top: 2rem;
  padding-top: 1rem;
  border-top: 1px solid #eee;
  color: #666;
}

.loading {
  background: #0066cc;
  color: white;
  padding: 0.5rem;
  border-radius: 4px;
  margin-bottom: 1rem;
}

code {
  background: #f5f5f5;
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  font-family: monospace;
}
```

### 6. Create HTML Template

The HTML template serves as the entry point and includes our CSS file.

**`index.html`**
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Full-Stack App</title>
  <link href="/src/styles.css" rel="stylesheet">
</head>
<body>
  <script type="module" src="/src/index.browser.ts"></script>
</body>
</html>
```

### 7. Create Server Entry Point

The server entry point initializes your Alepha application and starts the HTTP server.

**`src/index.server.ts`**
```typescript
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AppRouter);

run(alepha);
```

### 8. Create Browser Entry Point

The browser entry point handles client-side hydration and navigation.

**`src/index.browser.ts`**
```typescript
import { Alepha, run } from "alepha";
import { AppRouter } from "./AppRouter.ts";

const alepha = Alepha.create();

alepha.with(AppRouter);

run(alepha);
```

### 9. Configure Vite

Vite handles the build process and development server for your full-stack application.

**`vite.config.ts`**
```typescript
import { viteAlepha } from "@alepha/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    viteReact(),
    viteAlepha({
      // Point to your server entry file
      serverEntry: "./src/index.server.ts",
    }),
  ],
});
```

### 10. Update Package.json

Add the necessary scripts and update your package.json:

**`package.json`**
```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
```

### 10. Run Your Full-Stack Application

Now you can run your application in development mode:

```bash
npm run dev
```

Visit `http://localhost:5173` in your browser. You'll see:

- **Server-Side Rendering**: The page loads instantly with pre-rendered HTML
- **Client-Side Navigation**: Smooth navigation between pages without full page reloads
- **Type Safety**: Full TypeScript support throughout your application
- **Data Fetching**: Server-side data loading with automatic serialization

### 11. Build for Production

When you're ready to deploy, build your application:

```bash
npm run build
```

This creates:
- Optimized client-side bundles in `dist/client/`
- Server-side code in `dist/server/`
- Static assets with proper caching headers

### What You've Built

Congratulations! 🎉 You've created a complete full-stack application with:

- **Type-Safe Routing**: Using `$page` descriptors for all routes
- **Server-Side Rendering**: Fast initial page loads with SEO benefits
- **Client-Side Navigation**: Smooth single-page app experience
- **Data Fetching**: Server-side data loading with automatic hydration
- **Static Generation**: Performance optimization for static content
- **Development Tools**: Hot module replacement and TypeScript support

### Next Steps

From here, you can:

- Add more complex pages with nested routing
- Integrate databases with `@alepha/postgres`
- Add email functionality with `@alepha/email`
- Implement background jobs with `@alepha/queue`
- Add authentication with `@alepha/security`
- Deploy to production platforms like Vercel or Railway

Your full-stack Alepha application is now ready for real-world development!
