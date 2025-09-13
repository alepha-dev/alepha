# Alepha Retry

Simple, declarative, and powerful automatic retry for failed operations.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/retry
```


## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

#### $retry()

Creates a function that automatically retries a handler upon failure,
with support for exponential backoff, max duration, and cancellation.
