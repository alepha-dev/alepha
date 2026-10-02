# @alepha/ui - Form

## Installation

```bash
npm install @alepha/ui
```

## Overview

Schema-driven forms.

`AutoForm` renders a complete form from a `z.object()` schema, driven by the
`$control` metadata on each field. `Control` is the per-field dispatcher it
uses, and `ControlSelect`, `ControlDate`, `ControlDateRange`,
`ControlNumber`, `ControlPassword`, `ControlUpload`, `ControlArray` and
`ControlObject` are the renderers behind it: reach for them directly to lay a
form out by hand. `FormField` is the label, description and error frame they
share, and `resizeImage` shrinks an upload before it leaves the browser.

Pairs with `useForm` from `alepha/react/form`.
