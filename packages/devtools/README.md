# Alepha @devtools

Developer tools for monitoring and debugging Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Developer tools module for monitoring and debugging Alepha applications.

This module provides comprehensive data collection capabilities for tracking application behavior,
performance metrics, and debugging information in real-time.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { Alepha@devtools } from "alepha/devtools";

const alepha = Alepha.create()
	.with(Alepha@devtools);

run(alepha);
```
