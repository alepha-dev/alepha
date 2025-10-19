# Alepha Api Gtfs

GTFS (General Transit Feed Specification) API endpoints for Alepha applications.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides GTFS (General Transit Feed Specification) API endpoints for Alepha applications.

This module includes:
- GTFS data import from ZIP files
- Query APIs for stops, routes, trips, stop times, calendar data
- Full-text search for stops and routes
- Journey planning with origin, destination, and departure time
- Support for multiple GTFS datasets

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaApiGtfs } from "alepha/api/gtfs";

const alepha = Alepha.create()
	.with(AlephaApiGtfs);

run(alepha);
```
