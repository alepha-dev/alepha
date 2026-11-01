# $manifest

## Import

```typescript
import { $manifest } from "alepha/react/sitemap";
```

## Overview

Serve a web app manifest generated from code, and link it from every page.

Prerendered by default, since nothing in it depends on where the app runs,
and answered as `application/manifest+json`.

## Options

| Option            | Type                                                        | Required | Description                               |
| ----------------- | ----------------------------------------------------------- | -------- | ----------------------------------------- |
| `name`            | `string`                                                    | Yes      |                                           |
| `shortName`       | `string`                                                    | No       |                                           |
| `description`     | `string`                                                    | No       |                                           |
| `display`         | `"fullscreen" \| "standalone" \| "minimal-ui" \| "browser"` | No       |                                           |
| `startUrl`        | `string`                                                    | No       |                                           |
| `backgroundColor` | `string`                                                    | No       |                                           |
| `themeColor`      | `string`                                                    | No       |                                           |
| `orientation`     | `"any" \| "portrait" \| "landscape"`                        | No       |                                           |
| `icons`           | `ManifestIcon[]`                                            | No       |                                           |
| `screenshots`     | `ManifestScreenshot[]`                                      | No       |                                           |
| `path`            | `string`                                                    | No       | Route path the manifest is served at.     |
| `static`          | `boolean`                                                   | No       | Prerender to a static file at build time. |

## Examples

```ts
import { $manifest } from "alepha/react/sitemap";

class AppRouter {
  manifest = $manifest({
    name: "My App",
    themeColor: "#010409",
    icons: [{ src: "/logo-512x512.png", sizes: "512x512", type: "image/png" }],
  });
}
```
