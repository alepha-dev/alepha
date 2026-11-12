# Accessibility: what is tested

`@alepha/ui` is **tested against WCAG 2.2 level AA**. This page says what that testing covers, component family by component family: which criteria each layer of evidence checks, which criteria nobody tested, which keyboard behaviours are proven, and the gaps that are known today. It describes the evidence. It is not a statement that the kit, or an application built on it, meets the standard.

The evidence on this page is from Alepha 0.37.0, run on 2026-11-12, in Chromium.

## The layers of evidence

| Layer                    | What it checks                                                                                                                                                                                                                            | Where it runs                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **Lint**                 | oxlint's `jsx-a11y` plugin on every source file: alt text, label association, interactive elements reachable by keyboard, valid ARIA attributes and roles.                                                                                | Every push.                                         |
| **axe, structure**       | axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules, on each component family rendered in jsdom, in its default state and in its open or error state: names, roles, ARIA wiring, labels, ids.                                          | The kit's unit tests, every push.                   |
| **axe, rendered page**   | The same rules on every page of the showcase in Chromium, styled and laid out, in four token sets: light, dark, and each with the colour-blind palette. This is the layer that measures contrast and target size.                         | Its own CI job, every push. A new finding fails it. |
| **Keyboard and focus**   | Real key presses in Chromium on the overlays the kit composes, and key events on the widgets it builds by hand.                                                                                                                           | Every push.                                         |
| **Colour-blind palette** | A unit test of the stylesheet's colour-blind token set: every signal colour is remapped in light and dark, the red and green pair becomes vermillion and blue, and every signal foreground keeps AA contrast against what it is drawn on. | Every push.                                         |
| **Accessibility tree**   | Pinned snapshots of the roles and accessible names of the shell, a form with fields in error, and an open confirm dialog.                                                                                                                 | Every push.                                         |

Three lint rules are switched off, each because it cannot see through Base UI's `render` prop or fights ARIA widgets built on purpose: `control-has-associated-label`, `anchor-has-content` and `prefer-tag-over-role`. The rules that catch an element a keyboard cannot use stay on.

axe finds roughly half of real accessibility issues by its own figure. A green scan is a floor, not a verdict, which is why the keyboard specs and the tree snapshots exist beside it.

## Criteria and the layer that covers them

| Criterion                                                | Covered by                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| 1.1.1 Non-text Content                                   | Lint, axe (structure and rendered page)                               |
| 1.3.1 Info and Relationships                             | axe (structure and rendered page), accessibility tree                 |
| 1.4.1 Use of Color                                       | axe on the rendered page (links in text), colour-blind palette test   |
| 1.4.3 Contrast (Minimum)                                 | axe on the rendered page, four token sets. Known gaps below.          |
| 1.4.11 Non-text Contrast                                 | **Not tested by any layer.** axe has no rule for it. Known gap below. |
| 2.1.1 Keyboard                                           | Lint, keyboard specs, axe (scrollable regions)                        |
| 2.1.2 No Keyboard Trap                                   | Keyboard specs (every overlay closes on Escape)                       |
| 2.4.3 Focus Order                                        | Keyboard specs (focus into overlays and back to the trigger)          |
| 2.4.6 Headings and Labels                                | axe (structure), accessibility tree                                   |
| 2.5.3 Label in Name                                      | axe on the rendered page                                              |
| 2.5.8 Target Size (Minimum)                              | axe on the rendered page. Known gap below.                            |
| 3.3.1 Error Identification, 3.3.2 Labels or Instructions | axe (structure), accessibility tree of a form in error                |
| 4.1.2 Name, Role, Value                                  | Lint, axe (structure and rendered page), accessibility tree           |

**Not tested** by any layer: 1.2 (time-based media), 1.3.4 Orientation, 1.3.5 Identify Input Purpose (beyond `autocomplete` on the auth forms), 1.4.4 Resize Text, 1.4.10 Reflow, 1.4.12 Text Spacing, 1.4.13 Content on Hover or Focus, 2.2 Enough Time, 2.3 Seizures, 2.4.7 Focus Visible and 2.4.11 Focus Not Obscured, 2.5.1 Pointer Gestures, 2.5.7 Dragging Movements (the tree's drag and drop has no keyboard alternative of its own), 3.1 Language, 3.2 Predictable, 3.3.3 to 3.3.8 (error suggestion, prevention, redundant entry, authentication).

## Per component family

| Family                                                         | axe, structure (states)                         | axe, rendered page                   | Keyboard                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------ |
| Buttons, badges, avatars, spinners, separators                 | default                                         | `/blocks/buttons`                    | native                                                                               |
| Alert, card, empty state                                       | default                                         | showcase pages                       | n/a                                                                                  |
| Inputs, textarea, checkbox, switch, slider, progress           | default                                         | `/blocks/control/*`                  | native, Base UI                                                                      |
| Breadcrumb, pagination, table                                  | default                                         | data table pages                     | native                                                                               |
| Tabs, collapsible                                              | open                                            | `/blocks/primitives`                 | Base UI                                                                              |
| Dialog, alert dialog, sheet, drawer                            | open                                            | `/blocks/dialog`, `/blocks/overlays` | focus in, Tab trapped, Escape closes, focus back                                     |
| Stacked overlays (a dialog over a sheet)                       | n/a                                             | `/blocks/overlays`                   | Escape closes the top layer only, focus back to its opener                           |
| Overlay route (`$page({ overlay })`)                           | n/a                                             | `/blocks/overlays/panel`             | focus in, Escape goes back with the focus on the link; full page by URL              |
| Dropdown menu, context menu, menubar                           | menu open                                       | `/blocks/primitives#menu`            | ArrowDown, Enter runs the item, Escape back to the trigger                           |
| Popover, hover card, tooltip                                   | open                                            | `/blocks/primitives#tooltip`         | Base UI                                                                              |
| Combobox and `ControlSelect`                                   | open, with and without search                   | `/blocks/control/select#open`        | opens from the keyboard, arrows move, Enter picks, Escape closes                     |
| Segmented, stepper, pane rail, toaster                         | default, a value checked, a toast shown         | showcase pages                       | Segmented: arrows, Home, End                                                         |
| Forms (`Control`, `AutoForm`)                                  | default and fields in error                     | `/pages/auth/register#error`         | native                                                                               |
| Data table                                                     | filter bar holding a filter, header filter open | `/blocks/data-table/*`               | tab band: one tab stop, arrows, Home, End                                            |
| Tree                                                           | nested rows                                     | `/blocks/tree`                       | one tab stop, Up, Down, Home, End, Right opens or steps in, Left closes or steps out |
| Shell (app shell, sidebar, plate and detail layouts, settings) | default                                         | every page                           | the sidebar as a sheet under the mobile breakpoint: opens, traps, closes             |
| Command palette                                                | list open                                       | `/blocks/buttons#palette`            | focus in, Tab trapped, Escape back to what opened it                                 |
| Calendar and date controls                                     | month grid                                      | `/blocks/control/date#popover`       | react-day-picker                                                                     |
| Auth, account, organizations, admin pages                      | default                                         | `/pages/*`                           | analytics menu: focus in on open, arrows, Home, End, Escape back to the trigger      |
| AI chat, markdown, API explorer                                | default, chat open                              | `/pages/developer/api`               | native                                                                               |
| Chart, one-time code, resizable panels                         | default                                         | showcase pages                       | input-otp, react-resizable-panels                                                    |

Base UI owns the keyboard behaviour of the primitives it provides. The kit does not re-test those key by key: it checks that each wrapper keeps the behaviour working, once per wrapper. Arrow keys are tested in left-to-right documents only.

Not scanned under jsdom: `TimeAgo`, `Highlight`, `FileImage`, `BrandIcon` and `FilterSlot`, which render text or an image.

## Known gaps

- **1.4.11 Non-text Contrast is not met** on the default palette for field borders and the focus ring. Against white, `--input` measures **1.26:1** and `--ring` **2.58:1**, where the criterion asks for 3:1. No automated layer checks this criterion: axe has no rule for it.
- **1.4.3 Contrast, muted text in light mode.** `--muted-foreground` on `--muted` measures **4.34:1**, under the 4.5:1 asked for normal text. It shows wherever muted text sits on a muted surface: the data table footer, the neutral tinted badge, counters, the tab band, keyboard hints, inline code, the permission matrix and ranks headers. A tab count on a tinted pill measures 3.52:1 in light mode and 4.33:1 in dark mode. The primary-coloured link on the admin user page is under 4.5:1 in dark mode. 52 findings in all, each listed in the scan's baseline.
- **2.5.8 Target Size.** The storage usage bar of the admin files page draws a small bucket as a 12 by 10 pixel button.
- **Landmarks.** The shell nests the page's `main` inside its own, and the sidebar's navigation is not inside a `navigation` landmark. axe reports neither under the WCAG rules, and neither is fixed yet.

## What stays the application's responsibility

The kit cannot test what an application puts in it:

- page titles, the heading order of each page, and the language of the page;
- link text and button labels that make sense out of context, and a name for every icon-only control the application adds;
- alt text for its images, and captions or transcripts for its media;
- colour choices in a custom theme or palette: the evidence above is for the default palette only;
- its own pages, content and flows, which this testing never saw.

An application can run the same checks on its own pages with `expectAccessible` and `expectPageAccessible` from `alepha/testing` (see [React Tests](/docs/guides-testing-react-tests) and [End-to-End Tests](/docs/guides-testing-e2e-tests)).

## The limits of this evidence

- **Chromium only.** No other browser was used.
- **No screen reader was used.** The accessibility tree snapshots pin what a screen reader reads from, in Chromium, not what any screen reader speaks.
- **The kit and its showcase only.** An application's own pages, palette and content were not scanned.
- **Dated.** The evidence describes the version and the run named at the top of this page.
- **No legal claim.** Accessibility law, such as the European Accessibility Act, applies to a product or a service, and a component library cannot meet it on an application's behalf. This page says which criteria are evidenced for the kit and what the application still owes.
