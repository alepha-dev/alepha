# useAuth

## Import

```typescript
import { useAuth } from "alepha/react/auth";
```

## Overview

Reads the current user and exposes `login()` / `logout()`.

`user` comes from the shared `currentUserAtom`, so every component using
this hook re-renders together on sign-in and sign-out. The type parameter
names your realm's auth providers, making `login("google")` type-safe.

## Examples

```typescript
const { user, login, logout } = useAuth();
if (!user) {
  await login("credentials", { username, password });
}
```

