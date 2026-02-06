# Alepha - Fake

## Installation

Part of the `alepha` package. Import from `alepha/fake`.

```bash
npm install alepha
```

## Overview

| Stability | Since | Runtime |
|-----------|-------|---------|
| 3 - stable | 0.11.0 | node, bun, workerd, browser|

Test data generation with Faker.js.

**Features:**
- TypeBox schema-based generation
- Context-aware field generation (email field -> email address)
- Test data seeding

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/concepts-providers).

#### FakeProvider

Generate fake data from TypeBox schemas using faker.js.
