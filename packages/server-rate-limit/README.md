# Alepha Server Rate Limit

Blocks requests that exceed a defined rate limit.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-rate-limit
```

## Module

Rate limiting configuration for this action.
		When specified, the action will be rate limited according to these settings.

## API Reference

### Descriptors

#### $rateLimit()

Declares rate limiting for server actions or custom usage.
This descriptor provides methods to check rate limits and configure behavior
within the server request/response cycle.
