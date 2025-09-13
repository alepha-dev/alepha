# Alepha Datetime

Date, time, and duration utilities based on Day.js.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/datetime
```


## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

#### $interval()

Run a function periodically.
It uses the `setInterval` internally.
It starts by default when the context starts and stops when the context stops.
