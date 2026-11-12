# Alepha - Testing Playwright

## Installation

Part of the `alepha` package. Import from `alepha/testing/playwright`.

```bash
npm install alepha
```

## Overview

Playwright helpers.

Collision-free e2e port allocation across concurrent checkouts, which is
what lets two agents (or two git worktrees) run the same suite at once
without fighting over a socket.

Accessibility checks in a real browser: `expectPageAccessible(page)` runs
axe on a Playwright page and fails on any WCAG 2.2 A or AA violation,
contrast and target size included, and `scanPageAccessibility(page)`
returns the same findings as data, to compare with a list of known ones.
Both need `@axe-core/playwright`, an optional peer.

⚠️ Node only. This module spawns a child process and reads the filesystem,
so it has no meaning on workerd or in a browser, and deliberately ships no
`index.workerd.ts`. It belongs in a Playwright config, never in app code.
