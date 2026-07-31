# Alepha - Server Health

## Installation

Part of the `alepha` package. Import from `alepha/server/health`.

```bash
npm install alepha
```

## Overview

Application health monitoring endpoints.

**Features:**
- `GET /health` and `GET /healthz`

supervisors read to tell a listening app from a serving one — an app cannot
usefully opt out of being checkable. Importing this module is now a no-op
beyond `AlephaServer` itself; drop it.

