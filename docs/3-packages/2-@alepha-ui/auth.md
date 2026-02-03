# @alepha/ui - Auth

## Installation

```bash
npm install @alepha/ui
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 2 - beta | 0.12.0 | node, bun, workerd, browser|

Authentication UI components.

**Features:**
- Login page component
- Register page component
- Reset password page component
- Email verification page component
- UserButton for user menu

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $uiAuth()

Register Auth UI components and get the AuthRouter instance.
