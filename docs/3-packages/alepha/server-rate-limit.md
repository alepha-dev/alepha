# Alepha - Server Rate Limit

## Installation

```bash
npm install alepha
```

## Overview

Provides rate limiting capabilities for server actions with configurable limits and windows.

The server-rate-limit module enables per-action rate limiting using the `rateLimit` option in action descriptors.
It offers sliding window rate limiting, custom key generation, and seamless integration with server routes.

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured descriptor instances.

For more details, see the [Descriptors documentation](/docs/descriptors).

#### $rateLimit()

Declares rate limiting for server actions or custom usage.
This descriptor provides methods to check rate limits and configure behavior
within the server request/response cycle.
