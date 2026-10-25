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

⚠️ Node only. This module spawns a child process and reads the filesystem,
so it has no meaning on workerd or in a browser, and deliberately ships no
`index.workerd.ts`. It belongs in a Playwright config, never in app code.
