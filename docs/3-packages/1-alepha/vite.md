# Alepha - Vite

## Installation

Part of the `alepha` package. Import from `alepha/vite`.

```bash
npm install alepha
```

## Overview

Vite plugins and tasks for Alepha framework.

This module provides Vite plugins and configurations to integrate Alepha applications with Vite's build and development processes.

```ts
import { defineConfig } from "vite";
import { viteAlephaDev } from "alepha/vite";

export default defineConfig({
  plugins: [viteAlephaDev()],
  // other Vite configurations...
});
```

