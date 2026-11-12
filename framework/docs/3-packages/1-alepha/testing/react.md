# Alepha - Testing React

## Installation

Part of the `alepha` package. Import from `alepha/testing/react`.

```bash
npm install alepha
```

## Overview

Testing utilities for Alepha React applications.

**Features:**

- `renderWithAlepha()` - Render components with Alepha context
- `fillForm()` / `submitForm()` - Form testing helpers
- `setupJsdomMocks()` - Mock browser APIs for jsdom
- `expectAccessible()` - Run axe on the rendered tree (structure only: no
  contrast under jsdom). Needs `axe-core`, an optional peer.
