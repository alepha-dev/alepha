# Alepha UI Registry

Alepha shadcn registry — blocks (auth, admin, app-shell) for Alepha SaaS apps.

## How it works

`@alepha/ui-registry` is a [shadcn registry](https://ui.shadcn.com/docs/registry) of pre-built blocks for Alepha apps — auth pages, admin views, form controls, an app shell, and more. Components are **copied into your project** via the shadcn CLI; you own the code and can edit freely.

## Setup

### New project (recommended)

Run [`alepha init --shadcn`](/docs/cli-commands-init) — it scaffolds `components.json` with the `@alepha` registry pre-wired:

```bash
alepha init --shadcn
```

### Existing shadcn project

Add the `@alepha` namespace under `registries` in your `components.json`:

```json
{
  "registries": {
    "@alepha": "https://alepha.dev/r/{name}.json"
  }
}
```

That's it — every block listed below is now resolvable by name:

```bash
yarn shadcn add @alepha/auth-login
# or pull the full SaaS bundle (auth + admin + controls + app-shell)
yarn shadcn add @alepha/saas
```

Components are copied into `src/components/` (or wherever your `components.json` aliases point) — you own the code and can edit freely.

## Blocks

### Auth

#### `@alepha/auth-login` — Login

Login page wired to Alepha auth (credentials + OAuth providers).

**Install**

```bash
yarn shadcn add @alepha/auth-login
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `realmConfig` | `RealmConfig` | Yes | Realm configuration (credential providers + OAuth buttons that render). |
| `registerPath` | `string` | No | Route to the registration page |
| `resetPasswordPath` | `string` | No | Route to the password-reset flow |
| `variant` | `"centered" \| "split"` | No | Layout variant |
| `background` | `Object` | No | Background panel configuration for the `split` variant |

**Dependencies:** `alepha`, `lucide-react`, `@alepha/control`, `shadcn:button`, `shadcn:card`, `shadcn:alert`, `shadcn:separator`

#### `@alepha/auth-register` — Register

Registration page with verification step (email/phone codes) when required by the realm.

**Install**

```bash
yarn shadcn add @alepha/auth-register
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `realmConfig` | `RealmConfig` | Yes | Realm configuration (drives required fields, verification step, OAuth buttons). |
| `loginPath` | `string` | No | Route to the login page |

**Dependencies:** `alepha`, `lucide-react`, `input-otp`, `@alepha/control`, `shadcn:button`, `shadcn:input-otp`, `shadcn:label`, `shadcn:card`, `shadcn:alert`, `shadcn:separator`

#### `@alepha/auth-reset-password` — Reset password

Four-step reset flow: email → code → new password → success.

**Install**

```bash
yarn shadcn add @alepha/auth-reset-password
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `realmConfig` | `RealmConfig` | Yes | Realm configuration (controls verification channel and password rules). |
| `loginPath` | `string` | No | Route to the login page, used after a successful reset. |

**Dependencies:** `alepha`, `lucide-react`, `@alepha/control`, `shadcn:button`, `shadcn:input`, `shadcn:label`, `shadcn:card`, `shadcn:alert`

#### `@alepha/auth-verify-email` — Verify email

Reads `email` and `token` from the URL, calls the verify endpoint, shows the result.

**Install**

```bash
yarn shadcn add @alepha/auth-verify-email
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `loginPath` | `string` | No | Route to the login page, shown as a CTA on success/failure. |
| `step` | `VerifyEmailStep` | No | Render a fixed step (useful for storybook / testing). |

**Dependencies:** `alepha`, `lucide-react`, `shadcn:button`, `shadcn:card`, `shadcn:alert`

### Admin

#### `@alepha/admin-audits` — Admin: Audits

Read-only audit log with paged history of API actions and resource changes.

**Install**

```bash
yarn shadcn add @alepha/admin-audits
```

**Dependencies:** `alepha`, `@alepha/alepha-table`, `shadcn:badge`

#### `@alepha/admin-files` — Admin: Files

Stored files across configured buckets with download + delete actions.

**Install**

```bash
yarn shadcn add @alepha/admin-files
```

**Dependencies:** `alepha`, `lucide-react`, `@alepha/alepha-table`, `@alepha/use-dialog`, `shadcn:badge`, `@alepha/sonner`

#### `@alepha/admin-jobs` — Admin: Jobs

Registered jobs with run counts, last-run timestamp, and manual trigger.

**Install**

```bash
yarn shadcn add @alepha/admin-jobs
```

**Dependencies:** `alepha`, `lucide-react`, `shadcn:badge`, `shadcn:button`, `shadcn:table`, `@alepha/sonner`

#### `@alepha/admin-keys` — Admin: API keys

Programmatic access tokens with revoke action.

**Install**

```bash
yarn shadcn add @alepha/admin-keys
```

**Dependencies:** `alepha`, `lucide-react`, `@alepha/alepha-table`, `@alepha/use-dialog`, `shadcn:badge`, `@alepha/sonner`

#### `@alepha/admin-notifications` — Admin: Notifications

Delivery log for emails, SMS, and other channels.

**Install**

```bash
yarn shadcn add @alepha/admin-notifications
```

**Dependencies:** `alepha`, `@alepha/alepha-table`, `shadcn:badge`

#### `@alepha/admin-parameters` — Admin: Parameters

Simplified parameters admin — list view only. The full Mantine version
has a tree view + history pane + per-key form; port those as separate
blocks if needed.

**Install**

```bash
yarn shadcn add @alepha/admin-parameters
```

**Dependencies:** `alepha`, `lucide-react`, `@alepha/alepha-table`, `@alepha/use-dialog`, `shadcn:badge`, `@alepha/sonner`

#### `@alepha/admin-payments` — Admin: Payments

Payment intents, charges, and subscriptions.

**Install**

```bash
yarn shadcn add @alepha/admin-payments
```

**Dependencies:** `alepha`, `@alepha/alepha-table`, `shadcn:badge`

#### `@alepha/admin-sessions` — Admin: Sessions

Active user sessions with revoke action.

**Install**

```bash
yarn shadcn add @alepha/admin-sessions
```

**Dependencies:** `alepha`, `lucide-react`, `@alepha/alepha-table`, `@alepha/use-dialog`, `shadcn:badge`, `@alepha/sonner`

#### `@alepha/admin-users` — Admin: Users

User list with bulk disable, per-row enable/disable + delete, linked to user profile.

**Install**

```bash
yarn shadcn add @alepha/admin-users
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `userRealmName` | `string` | No | Realm name to query users from |

**Dependencies:** `alepha`, `lucide-react`, `@alepha/alepha-table`, `@alepha/use-dialog`, `shadcn:avatar`, `shadcn:badge`, `@alepha/sonner`

### Form controls

#### `@alepha/control` — Control

Schema-driven form field renderer. Inspects the bound `InputField` from
`useForm`, evaluates `schema.$control` (object or function), merges the
result with explicit props, and dispatches to the right sub-control.

**Install**

```bash
yarn shadcn add @alepha/control
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `BaseInputField` | Yes | Bound `InputField` from `useForm` |
| `label` | `string` | No | Field label |
| `description` | `string` | No | Helper text shown below the control |
| `text` | `boolean` | No | Force a specific input variant — renders a single-line text input. |
| `area` | `boolean` | No | Force a textarea. |
| `password` | `boolean` | No | Force a masked password input. |
| `switch` | `boolean` | No | Force a `&lt;Switch&gt;` (boolean toggle). |
| `number` | `boolean` | No | Force a numeric input. |
| `file` | `boolean` | No | Force the file-upload control (alias for `upload`). |
| `date` | `boolean` | No | Force a date picker. |
| `datetime` | `boolean` | No | Force a date-time picker. |
| `time` | `boolean` | No | Force a time picker. |
| `select` | `boolean` | No | Force a `&lt;Select&gt;`. |
| `combobox` | `boolean` | No | Force a combobox (searchable select). |
| `segmented` | `boolean` | No | Force a `&lt;Segmented&gt;` control (one option visible at a time). |
| `slider` | `boolean` | No | Force a slider (numeric only). |
| `object` | `boolean` | No | Force a nested `&lt;ControlObject&gt;` for object-typed schemas. |
| `array` | `boolean` | No | Force a nested `&lt;ControlArray&gt;` for array-typed schemas. |
| `custom` | `ComponentType&lt;{ value: unknown; onChange: (v: unknown) =&gt;...` | No | Custom render component receiving `{value, onChange}`. |
| `icon` | `IconComponent \| string \| null` | No | Override icon — pass `null` to remove the schema-inferred icon. |
| `disabled` | `boolean` | No | Disable the control. |
| `top` | `ReactNode` | No | Render slot before the control. |
| `bottom` | `ReactNode` | No | Render slot after the control. |
| `width` | `100 \| 75 \| 66 \| 50 \| 33 \| 25` | No | Width slot inside an `&lt;AutoForm&gt;` group (mapped to a CSS grid column span) |
| `throttle` | `number` | No | Throttle text input onChange in ms |
| `autoComplete` | `string` | No | HTML `autocomplete` hint passed to the underlying input. |
| `placeholder` | `string` | No | HTML `placeholder` passed to the underlying input. |
| `createNewEntry` | `boolean \| ((query: string) =&gt; unknown)` | No | Allow user to create new entries in select / multi-select. |

**Dependencies:** `alepha`, `lucide-react`, `@alepha/control-base`, `@alepha/control-array`, `@alepha/control-object`, `@alepha/control-number`, `@alepha/control-date`, `@alepha/control-select`, `@alepha/control-upload`, `shadcn:input`, `shadcn:switch`, `shadcn:textarea`

#### `@alepha/control-array` — Control: Array

Recursive renderer for array schemas (objects or primitives) with add/remove.

**Install**

```bash
yarn shadcn add @alepha/control-array
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `BaseInputField` | Yes | Bound array `InputField` from `useForm`. |
| `label` | `string` | No | Field label |
| `description` | `string` | No | Helper text shown below the array. |
| `min` | `number` | No | Minimum number of items (Add button disables when reached). |
| `max` | `number` | No | Maximum number of items (Add button disables when reached). |
| `addLabel` | `string` | No | Override the "Add item" button label. |
| `columns` | `1 \| 2 \| 3 \| 4` | No | Number of grid columns for each item's inner fields. |
| `variant` | `"fieldset" \| "plain"` | No | "fieldset" wraps in a bordered container with legend; "plain" renders items only. |
| `controlProps` | `Record&lt;string, Partial&lt;Omit&lt;ControlProps, "input"&gt;&gt;&gt;` | No | Per-field `&lt;Control&gt;` overrides for items, keyed by inner field name. |
| `itemControlProps` | `Partial&lt;Omit&lt;ControlProps, "input"&gt;&gt;` | No | Override props applied to every item (when items are primitive, not objects). |
| `disabled` | `boolean` | No | Disable add/remove and all inner controls. |
| `defaultExpanded` | `boolean` | No | Default expanded state |
| `confirmDelete` | `boolean \| { title?: string; message?: string }` | No | Confirm before deleting an item |
| `renderTabName` | `Object` | No | Compute the visible label for each item header (and tab name in tabs mode). |
| `forceTabs` | `boolean` | No | Force tabs mode even for short arrays |

**Dependencies:** `alepha`, `lucide-react`, `@alepha/control`, `shadcn:button`

#### `@alepha/control-base` — Control base

Label + description + error wrapper shared by every Control variant.

When `error` is set, applies a red ring to any descendant `<input>`,
`<textarea>`, or trigger button via the `data-invalid` attribute (so we
don't have to thread `error` through every leaf widget).

**Install**

```bash
yarn shadcn add @alepha/control-base
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | No | `id` linked to the inner control's `htmlFor`. |
| `label` | `string` | No | Label text rendered above the control. |
| `description` | `string` | No | Helper text rendered below the control. |
| `error` | `string` | No | Error message |
| `required` | `boolean` | No | Show a required marker (`*`) next to the label. |
| `className` | `string` | No | Extra classes applied to the wrapper. |
| `children` | `ReactNode` | Yes | The control to wrap. |

**Dependencies:** `alepha`, `lucide-react`, `shadcn:label`

#### `@alepha/control-date` — Control: Date

Date / date-time / time picker (Calendar in Popover).

**Install**

```bash
yarn shadcn add @alepha/control-date
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `BaseInputField` | Yes | Bound `InputField` from `useForm` |
| `label` | `string` | No | Field label |
| `description` | `string` | No | Helper text shown below the picker. |
| `date` | `boolean` | No | Force date-only mode regardless of schema format. |
| `datetime` | `boolean` | No | Force date-time mode regardless of schema format. |
| `time` | `boolean` | No | Force time-only mode regardless of schema format. |
| `disabled` | `boolean` | No | Disable the picker. |

**Dependencies:** `alepha`, `lucide-react`, `@alepha/control-base`, `shadcn:button`, `shadcn:calendar`, `shadcn:input`, `shadcn:popover`

#### `@alepha/control-number` — Control: Number

Number input with optional slider variant.

**Install**

```bash
yarn shadcn add @alepha/control-number
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `BaseInputField` | Yes | Bound numeric `InputField` from `useForm`. |
| `label` | `string` | No | Field label |
| `description` | `string` | No | Helper text shown below the input. |
| `slider` | `boolean` | No | Render as a slider instead of a number input. |
| `min` | `number` | No | Minimum allowed value |
| `max` | `number` | No | Maximum allowed value |
| `step` | `number` | No | Step size |
| `disabled` | `boolean` | No | Disable the input. |

**Dependencies:** `alepha`, `@alepha/control-base`, `shadcn:input`, `shadcn:slider`

#### `@alepha/control-object` — Control: Object

Recursive renderer for nested object schemas.

**Install**

```bash
yarn shadcn add @alepha/control-object
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `BaseInputField` | Yes | Bound object `InputField` from `useForm`. |
| `label` | `string` | No | Field label |
| `description` | `string` | No | Helper text shown below the group. |
| `columns` | `1 \| 2 \| 3 \| 4` | No | Number of grid columns |
| `variant` | `"fieldset" \| "plain"` | No | "fieldset" wraps in a bordered container with legend |
| `controlProps` | `Record&lt;string, Partial&lt;Omit&lt;ControlProps, "input"&gt;&gt;&gt;` | No | Per-field control props override, keyed by field name. |
| `disabled` | `boolean` | No | Disable the group and all inner controls. |
| `defaultExpanded` | `boolean` | No | Default expanded state |
| `clearable` | `boolean` | No | Allow the user to clear the object (sets value to undefined). |

**Dependencies:** `alepha`, `@alepha/control`

#### `@alepha/control-select` — Control: Select

Native Select for short enums, Combobox for searchable / async / multi, animated Segmented control for short enums when requested.

**Install**

```bash
yarn shadcn add @alepha/control-select
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `BaseInputField` | Yes | Bound `InputField` from `useForm` |
| `label` | `string` | No | Field label |
| `description` | `string` | No | Helper text shown below the input. |
| `segmented` | `boolean` | No | Render as a `&lt;Segmented&gt;` control (best for 2–4 options). |
| `combobox` | `boolean` | No | Render as a searchable combobox instead of a native select. |
| `loader` | `Object` | No | Async option loader |
| `loaderThreshold` | `number` | No | Option count above which `loader` is invoked on every search instead of once |
| `loaderDebounce` | `number` | No | Debounce in ms applied to search queries when calling `loader` in long mode. |
| `disabled` | `boolean` | No | Disable the control. |
| `createNewEntry` | `boolean \| ((query: string) =&gt; Exclude&lt;SelectOption, string&gt;)` | No | Allow the user to add a new option by typing |

**Dependencies:** `alepha`, `lucide-react`, `@alepha/control-base`, `@alepha/segmented`, `shadcn:button`, `shadcn:command`, `shadcn:popover`, `shadcn:select`

#### `@alepha/control-upload` — Control: Upload

File upload control. Wraps `FileController.uploadFile`, stores the
resulting file ID(s) in the form, and renders a thumbnail preview for
images and a chip-style summary for everything else.

Single-file: form value is a uuid string.
Multi-file: form value is an array of uuid strings.

**Install**

```bash
yarn shadcn add @alepha/control-upload
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `input` | `BaseInputField` | Yes | Bound `InputField` from `useForm` |
| `label` | `string` | No | Field label |
| `description` | `string` | No | Helper text shown below the dropzone. |
| `multi` | `boolean` | No | Multi-file mode |
| `accept` | `string` | No | HTML `accept` filter on the file picker (e.g |
| `maxSize` | `number` | No | Max size per file (bytes) |
| `bucket` | `string` | No | Bucket name passed to the upload endpoint. |
| `disabled` | `boolean` | No | Disable the dropzone. |

**Dependencies:** `alepha`, `lucide-react`, `sonner`, `@alepha/control-base`, `shadcn:button`

### Buttons

#### `@alepha/button-dark` — Button: Dark

Three-state color-mode toggle: cycles `light → dark → system` on click.
Reads/writes the persisted UI cookie via `useColorMode()`.

**Install**

```bash
yarn shadcn add @alepha/button-dark
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | No | Optional aria-label override |

**Dependencies:** `alepha`, `lucide-react`, `shadcn:button`

#### `@alepha/button-language` — Button: Language

Dropdown listing every language registered via `$dictionary`. Switches the
active locale via `useI18n().setLang(code)`.

Labels come from translation keys `language.<code>` (e.g. `language.en`,
`language.fr`). If the key is missing, the raw code is shown — so adding a
new language to the picker is a one-line `tr` entry per dictionary.

Renders nothing when only one language is registered.

**Install**

```bash
yarn shadcn add @alepha/button-language
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | No | Optional aria-label override |

**Dependencies:** `alepha`, `lucide-react`, `shadcn:button`, `shadcn:dropdown-menu`

#### `@alepha/button-theme` — Button: Theme

Theme picker reading the available list from `uiThemeListAtom` and the
selected id from `useTheme()`. Apps register their themes once at boot:

```ts
alepha.store.set(uiThemeListAtom, [
  { id: "default", label: "Default" },
  { id: "claude",  label: "Claude", swatch: [...], fontHref: "https://..." },
]);
```

Selecting a theme with a `fontHref` lazily injects a single `<link>` into
`<head>` (id `alepha-theme-fonts`); switching themes swaps it. No effect
when the list has 0 or 1 entries.

**Install**

```bash
yarn shadcn add @alepha/button-theme
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `label` | `string` | No | Optional aria-label override |
| `heading` | `string` | No | Optional dropdown header |

**Dependencies:** `alepha`, `lucide-react`, `shadcn:button`, `shadcn:dropdown-menu`

#### `@alepha/button-user` — Button: User

Account button: shows a sign-in icon when logged out, a user icon with a
dropdown menu when logged in. Reads auth state via `useAuth()`.

**Install**

```bash
yarn shadcn add @alepha/button-user
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `children` | `ReactNode` | No | Custom menu items rendered between the email header and the logout footer |
| `onSignIn` | `Object` | No | Called when the user clicks the sign-in icon (logged-out state) |
| `onAdminClick` | `Object` | No | Called when the user clicks the default "Admin Panel" menu item |
| `label` | `string` | No | Optional aria-label override for the trigger. |

**Dependencies:** `alepha`, `lucide-react`, `shadcn:button`, `shadcn:dropdown-menu`

### Hooks

#### `@alepha/use-dialog` — useDialog

Imperative dialog API. Returns an object with:

- `confirm({ title, description? })` → `Promise<boolean>`
- `alert({ title, description? })` → `Promise<void>`
- `prompt({ title, label?, defaultValue?, validate? })` → `Promise<string | null>`

Requires {@link DialogProvider} mounted in the tree.

**Install**

```bash
yarn shadcn add @alepha/use-dialog
```

**Dependencies:** `shadcn:alert-dialog`, `shadcn:input`

#### `@alepha/use-toast` — useToast

Imperative toast API — thin facade over sonner. Returns the same `toast`
function exposed by `sonner`, so all variants are available:

- `toast(message)` — neutral
- `toast.success(message)` / `toast.error(message)` / `toast.info(message)`
- `toast.warning(message)` / `toast.loading(message)`
- `toast.promise(promise, { loading, success, error })`
- `toast.dismiss(id?)`

Requires a `<Toaster />` mounted somewhere in the tree (sonner).

Wrapped as a hook for API consistency with {@link useDialog} and to leave
room for an Alepha-side `ToastService` (e.g. an atom-driven default
duration / position) without changing call sites.

**Install**

```bash
yarn shadcn add @alepha/use-toast
```

**Dependencies:** `sonner`

### Other

#### `@alepha/alepha-table` — AlephaTable

Paginated, sortable, selectable table wired to Alepha `Page<T>` responses. Supports row actions and bulk actions.

**Install**

```bash
yarn shadcn add @alepha/alepha-table
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `fetch` | `Object` | Yes | Fetcher invoked with paging + sort |
| `columns` | `Record&lt;string, ColumnDef&lt;T&gt;&gt;` | Yes | Column definitions, keyed by the property name they read from. |
| `rowActions` | `Object` | No | Per-row action menu builder |
| `bulkActions` | `BulkAction&lt;T&gt;[]` | No | Actions applied to selected rows (enables checkbox column). |
| `defaultSize` | `number` | No | Default page size. |
| `rowKey` | `Object` | No | Stable row identifier |
| `onRowClick` | `Object` | No | Click handler invoked when a row is clicked (excluding action buttons). |
| `header` | `ReactNode` | No | Header content rendered above the table (e.g., title + filters). |
| `pollMs` | `number` | No | Auto-refresh interval in ms (only when document is visible). |
| `form` | `FormModel&lt;TObject&gt;` | No | Filter form |
| `className` | `string` | No | Extra classes applied to the outer wrapper. |
| `emptyMessage` | `string` | No | Message shown when the page is empty |

**Dependencies:** `alepha`, `lucide-react`, `shadcn:button`, `shadcn:checkbox`, `shadcn:dropdown-menu`, `shadcn:skeleton`, `shadcn:table`

#### `@alepha/app-shell` — AppShell

Standard SaaS layout: collapsible sidebar + topbar with breadcrumbs.
Built on shadcn `<Sidebar>` + `<Breadcrumb>`.

**Install**

```bash
yarn shadcn add @alepha/app-shell
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `brand` | `ReactNode` | No | Branding shown at the top of the sidebar. |
| `nav` | `NavGroup[]` | No | Sidebar navigation groups. |
| `sidebarFooter` | `ReactNode` | No | Content rendered at the bottom of the sidebar (user menu, etc.). |
| `breadcrumbs` | `Object` | No | Breadcrumb crumbs (last one is rendered as the current page). |
| `topbarActions` | `ReactNode` | No | Top-bar right-side content (search, theme toggle, user menu). |
| `variant` | `"sidebar" \| "floating" \| "inset"` | No | Layout variant |
| `headerOutside` | `boolean` | No | When `variant="inset"`, lift the header out of the floating card so it sits on the sidebar background — only the main page becomes the card |
| `progress` | `boolean \| NavigationProgressOptions` | No | Top loading bar shown during route transitions |
| `children` | `ReactNode` | No | Page content |

**Dependencies:** `alepha`, `lucide-react`, `shadcn:sidebar`, `shadcn:breadcrumb`, `shadcn:separator`, `@alepha/use-dialog`, `@alepha/sonner`

#### `@alepha/auto-form` — AutoForm

Schema-driven form with optional grouping, header chrome, and bottom
bar. Every input field is resolved through `<Control>`, so schemas
carrying `$control` metadata configure themselves.

**Install**

```bash
yarn shadcn add @alepha/auto-form
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `form` | `FormModel&lt;T&gt;` | Yes | Form model returned by `useForm()` |
| `icon` | `string` | No | Header icon (lucide name). |
| `title` | `string` | No | Header title. |
| `description` | `string` | No | Header description / subtitle. |
| `groups` | `AutoFormGroup[]` | No | Manual layout: list of groups, each with its own fields |
| `autoGroup` | `boolean \| { defaultTitle?: string; defaultIcon?: string }` | No | Auto-group: scan the schema, primitive fields land in a "General" group, each object/array-of-objects becomes its own group. |
| `fields` | `Partial&lt;` | No | Per-field control overrides keyed by field name (also works without groups). |
| `submitLabel` | `string` | No | Submit button label. |
| `noSubmit` | `boolean` | No | Hide built-in submit button. |
| `disabledIfPristine` | `boolean` | No | Disable submit when form is pristine (not dirty). |
| `disabled` | `boolean` | No | Disable the entire form (cascades to controls). |
| `onCancel` | `Object` | No | Cancel button — hidden when omitted. |
| `skipReset` | `boolean` | No | Skip the reset button in the bottom bar. |
| `skipBottomBar` | `boolean` | No | Skip the entire bottom bar. |
| `actions` | `AutoFormAction[]` | No | Extra action buttons in the bottom bar (left side). |
| `footer` | `ReactNode` | No | Extra content rendered above the bottom bar. |
| `throttle` | `number` | No | Throttle (ms) for text inputs |
| `className` | `string` | No | Extra classes applied to the form wrapper. |

**Dependencies:** `alepha`, `@alepha/control`, `shadcn:button`

#### `@alepha/language-toggle` — Language toggle

Dropdown that lists every language registered via `$dictionary` and lets the
user switch. Reads the active language and the registered list directly from
`useI18n()`, so it stays in sync without extra wiring.

**Install**

```bash
yarn shadcn add @alepha/language-toggle
```

**Dependencies:** `alepha`, `lucide-react`, `shadcn:button`, `shadcn:dropdown-menu`

#### `@alepha/saas` — Alepha SaaS preset

One-shot init: control + auto-form + alepha-table + use-dialog + use-toast + app-shell + auth pages + admin (users, sessions). Add more admin-* blocks as needed.

**Install**

```bash
yarn shadcn add @alepha/saas
```

**Dependencies:** `alepha`, `lucide-react`, `@alepha/control`, `@alepha/auto-form`, `@alepha/alepha-table`, `@alepha/use-dialog`, `@alepha/use-toast`, `@alepha/app-shell`, `@alepha/auth-login`, `@alepha/auth-register`, `@alepha/auth-reset-password`, `@alepha/auth-verify-email`, `@alepha/admin-users`, `@alepha/admin-sessions`, `@alepha/sonner`, `shadcn:tooltip`

#### `@alepha/segmented` — Segmented

Animated segmented control with a sliding indicator behind the active option.

**Install**

```bash
yarn shadcn add @alepha/segmented
```

**Props**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `options` | `SegmentedOption[]` | Yes | Selectable options |
| `value` | `string` | No | Controlled value |
| `defaultValue` | `string` | No | Initial value when uncontrolled. |
| `onChange` | `Object` | No | Called when the active segment changes. |
| `size` | `"sm" \| "md" \| "lg"` | No | Visual size — `sm`, `md` (default), or `lg`. |
| `fullWidth` | `boolean` | No | Stretch segments to fill the available width. |
| `disabled` | `boolean` | No | Disable all segments. |
| `name` | `string` | No | Optional form name (used when rendered inside a form). |

#### `@alepha/sonner` — Sonner (Alepha)

Toaster component using Alepha's useColorMode instead of next-themes.

**Install**

```bash
yarn shadcn add @alepha/sonner
```

**Dependencies:** `alepha`, `lucide-react`, `sonner`

