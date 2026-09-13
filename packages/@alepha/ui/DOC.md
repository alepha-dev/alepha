## Overview

`@alepha/ui` is the shared component library for Alepha applications, built
on Base UI and Tailwind, with [lucide](https://lucide.dev) icons.

Unlike the rest of the framework, these components are **meant to be edited
directly**: `src/` ships alongside the built `dist/`, so you can copy a
component into your app and change it, or depend on the package and let
bugfixes arrive through normal dependency updates.

## Import paths

The package is sixteen modules, one subpath each. The primitives are the package
root; everything heavier is a subpath of its own, so an app loads only what it
renders:

```ts
import { Button, cn, useToast } from "@alepha/ui";
import { AutoForm } from "@alepha/ui/form";
import { AlephaTable } from "@alepha/ui/table";
import { AdminRouter } from "@alepha/ui/admin";
```

Load the stylesheet once, at your app's entry point:

```ts
import "@alepha/ui/styles.css";
```

A module's files are private: import from the subpath, never from a file
inside it. Inside the package the rule is the opposite - every import is
relative and names a concrete file - and `check:conventions` enforces both
the module map and that `@alepha/ui` (the root) imports no other module.

## What's inside

| Subpath                | What it holds                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@alepha/ui`           | The primitives (`Button`, `Input`, `Card`, `Badge`, `Dialog`, `Sheet`, `Tooltip`, `Sidebar`, and the rest), `cn`, `useToast` + `Toaster`, `useDialog` + `DialogProvider`, `useIsMobile`, `TimeAgo`, `UserAvatar` |
| `@alepha/ui/form`      | `AutoForm`, `Control` and the per-type renderers (`ControlSelect`, `ControlDate`, `ControlUpload`, ...), `FormField`, `resizeImage`                                                                              |
| `@alepha/ui/settings`  | The settings kit: `SettingsLayout`, `SettingsNav`, `SettingsSection`, `SettingsRow`, `SettingsDangerSection`                                                                                                     |
| `@alepha/ui/table`     | `AlephaTable` and its parts, `paginateLocal`, `useTableSelection`, `PermissionMatrix`                                                                                                                            |
| `@alepha/ui/tree`      | `TreeView`, `TreeViewResizer`, `useTreeState`, and the tree model (`buildTree`, `flattenTree`, `resolveDrop`, ...)                                                                                               |
| `@alepha/ui/markdown`  | `MarkdownView` and the diagram parsers. See the section below                                                                                                                                                    |
| `@alepha/ui/shell`     | `AppShell`, `NavShell` and its `Spotlight`, `PlateLayout`, `DetailLayout`, `AppActions`, the header buttons, `ActionErrorToaster`                                                                                |
| `@alepha/ui/auth`      | `AuthRouter` and its pages, `TurnstileWidget`                                                                                                                                                                    |
| `@alepha/ui/account`   | `AccountRouter`, `$pageAccount`, and the account pages                                                                                                                                                           |
| `@alepha/ui/admin`     | `AdminRouter`, `$pageAdmin`, the admin pages and `AdminAnalytics`                                                                                                                                                |
| `@alepha/ui/chart`     | The recharts wrapper (`ChartContainer` and its parts). Opt-in                                                                                                                                                    |
| `@alepha/ui/command`   | The cmdk wrapper (`Command`, `CommandDialog`). Opt-in                                                                                                                                                            |
| `@alepha/ui/calendar`  | The react-day-picker wrapper (`Calendar`). Opt-in                                                                                                                                                                |
| `@alepha/ui/otp`       | The input-otp wrapper (`InputOTP`). Opt-in                                                                                                                                                                       |
| `@alepha/ui/resizable` | The react-resizable-panels wrapper. Opt-in                                                                                                                                                                       |
| `@alepha/ui/i18n/fr`   | `uiFr`, the French catalogue for every key the package asks for                                                                                                                                                  |

The five opt-in wrappers import only the root, so a heavy dependency (recharts,
cmdk, react-day-picker, input-otp, react-resizable-panels) is loaded by the app
that imports its subpath and by nothing else.

> `useDialog()` throws without a `<DialogProvider>` above it, and toasts need a
> `<Toaster />`. `AppShell` mounts both. The account and admin routers do
> **not** - a second `<Toaster />` under an app that already has one shows every
> toast twice - so a standalone mount (or `AppShell` with `embedded`) has to
> wrap them itself.

## Example

`AutoForm` pairs with `useForm` from `alepha/react/form`. The schema is the
single source of truth - field types, validation, and layout hints all come
from it:

```tsx
import { AutoForm } from "@alepha/ui/form";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

const profileSchema = z.object({
  username: z
    .string()
    .min(2)
    .max(32)
    .meta({ $control: { icon: "user" } }),
  email: z.string(),
  newsletter: z.boolean(),
});

export const ProfilePage = () => {
  const form = useForm({
    schema: profileSchema,
    initialValues: { username: "", email: "", newsletter: false },
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
Reach for `SettingsSection` directly for the rows that are _not_ fields - an
avatar picker, a read-only value, a lone button.

Add `autoSave` to commit on change instead, which hides the action bar. Text
fields still never commit on keystroke: they commit on Enter, or on the inline
tick that appears in the input once the field is dirty.

## Markdown, and diagrams in it

`MarkdownView` renders markdown as formatted prose. Raw HTML is always escaped
to text, never promoted to markup: it renders content authored by one user to
another, so a live raw tag would be an injection point on every surface built on
this package.

### Spoilers

`||text||` renders as a covered box that reveals on click, on Enter or on
Space. Discord's syntax, and Discord's behaviour: inline markdown inside it
survives (`||see [the docs](/d) **now**||` hides a link and a bold word, not
the text of them), a code span and a fence keep their pipes literally, and an
unterminated `||` renders as the two characters that were typed rather than
swallowing the rest of the paragraph. A pair cannot cross a paragraph break.

⚠️ **It is not a security feature, and must never be described as one.** The
covered text is in the DOM from the first paint - the box is a colour, not an
absence - and it is also in the raw markdown, in an export, in whatever an API
or an MCP tool serves, and in any search snippet built from the source. It
hides a plot point from a reader's eye. It does not store a secret, and the
same words go in any UI that explains it.

A revealed spoiler stays revealed: re-hiding on blur would make it unreadable
with a keyboard, since reading what is around it is exactly what a reader does
next.

### Diagrams

A ` ```mermaid ` fence containing a **`flowchart`** or a **`sequenceDiagram`**
is drawn as an SVG diagram instead of a code block. The renderer is in-house
rather than mermaid itself: mermaid is roughly 500-900 kB gzip in a browser and
cannot run without a DOM, because it measures text in a hidden element. Here the
only imported piece is `graphre` (dagre in TypeScript, ~15.5 kB gzip), and only
the flowchart uses it; parsing, text measurement and drawing are ours. The whole
thing is one lazy chunk of about 22 kB gzip, imported only when a document
actually contains a fence, so a document with no diagram pays nothing.

The two are separate pipelines that share only the text metrics and the theming.
A flowchart has to be ranked, which is what `graphre` does; a sequence diagram
has both axes decided by the source - participants left to right in declaration
order, rows top to bottom in statement order - so its layout is arithmetic with
no library at all.

Drawing it ourselves is what makes the diagram look like the app: the SVG uses
`--card`, `--border`, `--muted-foreground` and `--muted`, so dark mode works
with no second palette and no theme prop.

The syntax is mermaid's so a document stays portable to GitHub, Obsidian and
anywhere else, but only a subset is drawn.

### Flowcharts

|             |                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header      | `flowchart` / `graph`, `TD` `TB` `LR` `RL` `BT`                                                                                                                             |
| Nodes       | `[rect]` `(rounded)` `{diamond}` `((circle))`; `([ ])` `[[ ]]` `[( )]` `{{ }}` `> ]` `[/ /]` `[\ \]` `((( )))` are consumed and mapped onto those four                      |
| Edges       | `-->` `---` `-.->` `==>` `<-->`; `--o` and `--x` parse, but the emitter has one end marker, so they draw the same arrowhead as `-->` rather than mermaid's circle and cross |
| Edge labels | both `-->\|text\|` and `-- text -->`                                                                                                                                        |
| Structure   | chains `A --> B --> C`, fans `A & B --> C`, nested `subgraph`                                                                                                               |
| Text        | `<br/>` becomes a line break; quoted and backtick-quoted labels                                                                                                             |

⚠️ **A node label must not contain a link operator.** The statement is scanned
for links before anything knows where the labels are, so a `--`, `==` or `-.`
sequence inside `[...]` is read as an edge and the label is cut. `A[--o]` yields
an empty `A` and a bogus node named `]`; `A[pre--post]` truncates to `pre`.
Quoting does NOT protect it - `A["-->"]` is damaged identically, because
`splitOnLinks` runs with no quote awareness. A single hyphen (`A[well-known]`)
is safe. There is no escape that works today, and the failure is silent: the
graph still draws, with the wrong text.

### Sequence diagrams

|              |                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Participants | `participant A`, `participant A as Alice`, `actor U` (an actor draws a stick figure); declared implicitly by first use, in order of appearance        |
| Arrows       | `->` `-->` `->>` `-->>` `-x` `--x` `-)` `--)`; the double hyphen dashes the line, and the four heads (none, filled, cross, open) are drawn distinctly |
| Activation   | `->>+` / `-->>-` and `activate` / `deactivate` parse and are DISCARDED - activation bars are not drawn                                                |
| Notes        | `Note left of A:`, `Note right of A:`, `Note over A:`, `Note over A,B:`                                                                               |
| Fragments    | `alt` / `else` / `opt` / `loop`, nested, each closed by `end`                                                                                         |
| Other        | `autonumber` (including `autonumber 10 10`), self-messages, `<br/>` line breaks                                                                       |

A sequence diagram keeps its natural width in a horizontal scroll frame rather
than scaling into the prose column. A flowchart is roughly as tall as it is wide
and shrinks gracefully; a sequence diagram's width comes from its participant
count with nothing to wrap, so scaling eight lifelines into a phone column puts
the labels at around 5px with no way for the reader to recover. The frame is
focusable and carries an accessible name, because a scroll container that cannot
take focus cannot be scrolled from a keyboard.

Two constructs are refused rather than approximated. `par`, `critical`, `break`,
`create` and `destroy` send the WHOLE diagram back to the code block: drawing
`par` branches one under the other would assert an ordering that is false, and
silently wrong output about a protocol is worse than no output. `rect`, `box`,
`links`, `link`, `menu` and `style` are skipped in silence, being decorative.

### Everything else

Degrades to the code block it renders as today, silently: `classDiagram`,
`gantt` and mindmaps are not drawn, `style` and `classDef` are ignored (the
theme picks the colours), and a malformed diagram, a parse failure, a graph past
the 200-node / 400-edge cap or a sequence diagram past the 30-participant /
300-row cap all render the plain fence rather than an error.

The font is pinned rather than inherited. Layout needs node sizes before it can
place anything, and node width comes from a generated per-character width table
measured against Inter at one size; inheriting the surrounding face would make
text and box disagree, differently on every surface.

## Adding a component

The package owns every file in it: there is no registry to pull from and no
generator to run. A new primitive is written by hand in `src/core/`, one file
per family, named after it (`DropdownMenu.tsx` holds the menu and all its
parts), and re-exported from `src/core/index.ts`. An upstream component
(shadcn's, Base UI's own examples) is a fine starting point, copied in and then
edited like any other file here: `cn` comes from `./utils.ts`, and a
`data-slot` attribute on each part keeps it addressable from `styles.css`.
