# Alepha Vite

Vite plugin for building Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Plugin vite for Alepha framework.

This module provides Vite plugins and configurations to integrate Alepha applications with Vite's build and development processes.

```ts
import { defineConfig } from "vite";
import { viteAlepha } from "@alepha/vite";

export default defineConfig({
  plugins: [viteAlepha()],
  // other Vite configurations...
});
```
