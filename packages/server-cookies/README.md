# Alepha Server Cookies

Type-safe HTTP cookie parsing and serialization for servers.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-cookies
```
## Module

Provides HTTP cookie management capabilities for server requests and responses with type-safe cookie descriptors.

The server-cookies module enables declarative cookie handling using the `$cookie` descriptor on class properties.
It offers automatic cookie parsing, secure cookie configuration, and seamless integration with server routes
for managing user sessions, preferences, and authentication tokens.

**Key Features:**
- Declarative cookie definition with `$cookie` descriptor
- Automatic cookie parsing from requests
- Secure cookie configuration (httpOnly, secure, sameSite)
- Type-safe cookie values with schema validation
- Automatic cookie serialization and deserialization
- Integration with server request/response lifecycle

**Basic Usage:**
```ts
import { Alepha, run, t } from "alepha";
import { AlephaServer, $route } from "alepha/server";
import { AlephaServerCookies, $cookie } from "alepha/server/cookies";

class AuthRoutes {
  // Define authentication cookie
  authToken = $cookie({
    name: "auth_token",
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: "7d",
  });

  // Define user preferences cookie
  userPrefs = $cookie({
    name: "user_prefs",
    schema: t.object({
      theme: t.union([t.literal("light"), t.literal("dark")]),
      language: t.string(),
    }),
    maxAge: "30d",
  });

  login = $route({
    path: "/login",
    method: "POST",
    schema: {
      body: t.object({
        email: t.string(),
        password: t.string(),
      }),
    },
    handler: async ({ body, reply }) => {
      const user = await authenticateUser(body.email, body.password);
      if (!user) {
        return new Response("Invalid credentials", { status: 401 });
      }

      const token = await generateJWT(user.id);

      // Set authentication cookie
      this.authToken.set(reply, token);

      return Response.json({ success: true, user });
    },
  });

  profile = $route({
    path: "/profile",
    method: "GET",
    handler: async ({ cookies }) => {
      // Get authentication token from cookie
      const token = this.authToken.get(cookies);
      if (!token) {
        return new Response("Unauthorized", { status: 401 });
      }

      const user = await validateJWT(token);
      const preferences = this.userPrefs.get(cookies) || {
        theme: "light",
        language: "en",
      };

      return Response.json({ user, preferences });
    },
  });

  logout = $route({
    path: "/logout",
    method: "POST",
    handler: async ({ reply }) => {
      // Clear authentication cookie
      this.authToken.clear(reply);
      return Response.json({ success: true });
    },
  });
}

const alepha = Alepha.create()
  .with(AlephaServer)
  .with(AlephaServerCookies)
  .with(AuthRoutes);

run(alepha);
```

**Advanced Cookie Management:**
```ts
class SessionRoutes {
  // Session cookie with custom configuration
  sessionId = $cookie({
    name: "session_id",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: "2h",
    encrypt: true, // Optional encryption
  });

  // Shopping cart cookie
  cart = $cookie({
    name: "shopping_cart",
    schema: t.object({
      items: t.array(t.object({
        id: t.string(),
        quantity: t.number(),
      })),
      total: t.number(),
    }),
    maxAge: "30d",
  });

  // Tracking consent cookie
  consent = $cookie({
    name: "tracking_consent",
    schema: t.object({
      analytics: t.boolean(),
      marketing: t.boolean(),
      functional: t.boolean(),
    }),
    maxAge: "1y",
  });

  updateCart = $route({
    path: "/cart",
    method: "POST",
    schema: {
      body: t.object({
        productId: t.string(),
        quantity: t.number(),
      }),
    },
    handler: async ({ body, cookies, reply }) => {
      const currentCart = this.cart.get(cookies) || { items: [], total: 0 };

      // Update cart logic
      const existingItem = currentCart.items.find(item => item.id === body.productId);
      if (existingItem) {
        existingItem.quantity = body.quantity;
      } else {
        currentCart.items.push({ id: body.productId, quantity: body.quantity });
      }

      // Recalculate total
      currentCart.total = await calculateCartTotal(currentCart.items);

      // Update cookie
      this.cart.set(reply, currentCart);

      return Response.json(currentCart);
    },
  });
}
```

## API Reference

### Descriptors

#### $cookie()

Declares a type-safe, configurable HTTP cookie.
This descriptor provides methods to get, set, and delete the cookie
within the server request/response cycle.
