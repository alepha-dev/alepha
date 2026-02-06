# useRouter

> Use this hook to access the React Router instance.

## Import

```typescript
import { useRouter } from "alepha/react/router";
```

## Overview

Use this hook to access the React Router instance.

You can add a type parameter to specify the type of your application.
This will allow you to use the router in a typesafe way.

## Examples

class App {
  home = $page();
}

const router = useRouter<App>();
router.push("home"); // typesafe

