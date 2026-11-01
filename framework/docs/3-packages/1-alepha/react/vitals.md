# Alepha - React Vitals

## Installation

Part of the `alepha` package. Import from `alepha/react/vitals`.

```bash
npm install alepha
```

## Overview

Core Web Vitals per page, as events. Opt-in, and free of React at runtime, so
a module that only wants the numbers can use it without the router.

## API Reference

### Providers

- [`ReactVitalsProvider`](/docs/reference-providers-reactvitalsprovider) - Reports Core Web Vitals per page, as events: `react:vital:measured` for each
