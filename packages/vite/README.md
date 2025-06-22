# alepha/vite

Vite plugin for building Alepha applications.

```ts
// vite.config.ts
import { defineConfig } from "vite"; // or rolldown-vite
import { viteAlepha } from "alepha/vite";

export default defineConfig({
	// ...
	plugins: [
		viteAlepha({}),
	],
});
```
