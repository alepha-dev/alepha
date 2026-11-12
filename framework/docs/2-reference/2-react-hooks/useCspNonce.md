# useCspNonce

## Import

```typescript
import { useCspNonce } from "alepha/react/router";
```

## Overview

The CSP nonce of the page being rendered on the server.

For a component that writes an inline `<script>` of its own: a library's
pre-hydration script, through that library's CSP provider.

`undefined` in the browser, where the script has already run from the
server's HTML, and on any render with no nonce: the CSP off, a page cache
hit, a prerender. A page whose markup carries the nonce is never stored by
the page cache, so prefer a hash for a script whose content is constant.

## Examples

```tsx
import { CSPProvider } from "@base-ui/react/csp-provider";

const Widget = () => (
  <CSPProvider nonce={useCspNonce()}>{...}</CSPProvider>
);
```
