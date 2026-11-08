# useRouter

## Import

```typescript
import { useRouter } from "alepha/react/router";
```

## Overview

Use this hook to access the React Router instance.

It is typed against the app's registered routers (see `Routers`), so page
names and their params are checked with no type argument. A type argument
still overrides it, and `useRouter<any>()` opts out, which is what code
meant to run in any app writes.

## Examples

class App {
home = $page();
}

declare module "alepha/react/router" {
interface Routers {
app: App;
}
}

const router = useRouter();
router.push("home"); // typesafe
