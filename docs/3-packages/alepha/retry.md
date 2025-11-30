# Alepha - Retry

## Installation

```bash
npm install alepha
```

## Overview

Retry mechanism provider for Alepha applications.

## API Reference

### Primitives

Primitives are functions that define and configure various aspects of your application. They follow the convention of starting with ` $ ` and return configured primitive instances.

For more details, see the [Primitives documentation](/docs/concepts-primitives).

#### $retry()

Creates a function that automatically retries a handler upon failure,
with support for exponential backoff, max duration, and cancellation.

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### RetryProvider

The function to retry.
  /
  handler: T;

  /**
  The maximum number of attempts.
  
  @default 3
  /
  max?: number;

  /**
  The backoff strategy for delays between retries.
  Can be a fixed number (in ms) or a configuration object for exponential backoff.
  
  @default { initial: 200, factor: 2, jitter: true }
  /
  backoff?: number | RetryBackoffOptions;

  /**
  An overall time limit for all retry attempts combined.
  
  e.g., `[5, 'seconds']`
  /
  maxDuration?: DurationLike;

  /**
  A function that determines if a retry should be attempted based on the error.
  
  @default (error) => true (retries on any error)
  /
  when?: (error: Error) => boolean;

  /**
  A custom callback for when a retry attempt fails.
  This is called before the delay.
  /
  onError?: (error: Error, attempt: number, ...args: Parameters<T>) => void;

  /**
  An AbortSignal to allow for external cancellation of the retry loop.
  /
  signal?: AbortSignal;

  /**
  An additional AbortSignal to combine with the provided signal.
  Used internally by $retry to handle app lifecycle.
  /
  additionalSignal?: AbortSignal;
}

export interface RetryBackoffOptions {
  /**
  Initial delay in milliseconds.
  
  @default 200
  /
  initial?: number;

  /**
  Multiplier for each subsequent delay.
  
  @default 2
  /
  factor?: number;

  /**
  Maximum delay in milliseconds.
  /
  max?: number;

  /**
  If true, adds a random jitter to the delay to prevent thundering herd.
  
  @default true
  /
  jitter?: boolean;
}

/**
Service for executing functions with automatic retry logic.
Supports exponential backoff, max duration, conditional retries, and cancellation.
