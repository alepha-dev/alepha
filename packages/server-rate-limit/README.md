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

Provides rate limiting capabilities for server actions with configurable limits and windows.

The server-rate-limit module enables per-action rate limiting using the `rateLimit` option in action descriptors.
It offers sliding window rate limiting, custom key generation, and seamless integration with server routes.

## API Reference

### Descriptors

#### $rateLimit()

Declares rate limiting for server actions or custom usage.
This descriptor provides methods to check rate limits and configure behavior
within the server request/response cycle.
