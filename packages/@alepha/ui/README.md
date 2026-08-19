# Alepha @alepha/ui

Shared shadcn Base UI Nova components for Alepha apps. Edited directly; bugfixes propagate via normal dep updates.

## Installation

Part of the Alepha framework, published on its own:

```bash
npm install @alepha/ui
```

## Overview

`@alepha/ui` is the shared component library for Alepha applications: a
[shadcn](https://ui.shadcn.com) collection in the `base-nova` style, built on
Base UI and Tailwind, with [lucide](https://lucide.dev) icons.

Unlike the rest of the framework, these components are **meant to be edited
directly**: `src/` ships alongside the built `dist/`, so you can copy a
component into your app and change it, or depend on the package and let
bugfixes arrive through normal dependency updates.

## Import paths

Every component lives in its own directory, so the import path repeats the
name:

```ts
import { Button } from "@alepha/ui/components/ui/button";
import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { cn } from "@alepha/ui/lib/utils";
```

Load the stylesheet once, at your app's entry point:

```ts
import "@alepha/ui/styles.css";
```

## What's inside

**`components/ui/*`** - the shadcn primitives, unmodified in spirit: `button`,
`input`, `card`, `badge`, `dialog`, `sheet`, `tooltip`, `label`, `accordion`,
`avatar`, and the rest. Reach for these first.

**Schema-driven forms** - `auto-form` renders a complete form from a `z.object()`
schema, driven by the `$control` metadata on each field. `control`,
`control-array`, `control-object`, `control-date`, `control-number`,
`control-select`, `control-password`, and `control-upload` are the per-type
field renderers it dispatches to; use them directly when you want to lay a form
out by hand.

**`alepha-table`** - data table wired for server-side pagination, sorting and
filtering.

**Application shells** - `app-shell` and `nav-shell` for page scaffolding,
`app-actions` for toolbars, plus ready-made `auth`, `account`, `settings`, and
`admin` screens.

**Hooks** - `use-toast` and `use-dialog` (imperative toasts and modals) live
under `components/`; `use-mobile` lives under `hooks/`.

**`lib/*`** - `utils` exports `cn()`, the `clsx` + `tailwind-merge` helper every
component uses. Also `resize-image` and `i18n-fr`.

## Example

`AutoForm` pairs with `useForm` from `alepha/react/form`. The schema is the
single source of truth - field types, validation, and layout hints all come
from it:

```tsx
import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const profileSchema = z.object({
  username: z.string().min(2).max(32).meta({ $control: { icon: "user" } }),
  email: z.string(),
  newsletter: z.boolean(),
});

export const ProfilePage = () => {
  const form = useForm({
    schema: profileSchema,
    defaultValues: { username: "", email: "", newsletter: false },
    handler: (values) => save(values),
  });

  return (
    <AutoForm
      form={form}
      icon="cog"
      title="Account profile"
      autoGroup
      disabledIfPristine
    />
  );
};
```

`autoGroup` derives field groups from the schema shape; pass `groups` instead to
lay them out yourself.

### Settings cards

`layout="row"` renders the same shape as the `SettingsSection` / `SettingsRow`
kit rather than an approximation of it: each group becomes a bordered card of
divided rows, label and help on the left, control on the right, and the action
bar is the card's own last row. Each group carries its own `title` and
`description`, rendered through the same `SettingsHeading` the kit uses.

```tsx
<AutoForm
  form={form}
  layout="row"
  disabledIfPristine
  groups={[
    {
      title: "Name",
      description: "How you are identified to other people.",
      fields: ["username", "firstName", "lastName"],
    },
  ]}
/>
```

So a settings card whose rows are all form fields should be an `AutoForm`.
Reach for `SettingsSection` directly for the rows that are *not* fields - an
avatar picker, a read-only value, a lone button.

Add `autoSave` to commit on change instead, which hides the action bar. Text
fields still never commit on keystroke: they commit on Enter, or on the inline
tick that appears in the input once the field is dirty.

## Adding a shadcn component

`components.json` is configured for this package, so the shadcn CLI drops new
components in the right place with the right aliases:

```bash
npx shadcn@latest add <component>
```

## Refreshing stock primitives

`yarn w @alepha/ui sync` re-fetches the stock `components/ui/*` primitives from
the public `ui.shadcn.com/r/styles/base-nova` registry and rewrites their
`@/registry/...` imports to `@alepha/ui/...`. It touches only the stock
primitives - the hand-maintained blocks (controls, admin, auth, app-shell,
alepha-table, …) are never overwritten. After a sync, diff for removed
`from "alepha/` imports before committing: the registry copy does not know
about local patches.

