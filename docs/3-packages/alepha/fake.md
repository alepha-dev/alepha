# Alepha - Fake

## Installation

```bash
npm install alepha
```

## Overview

Provides fake data generation capabilities for Alepha applications using faker.js and TypeBox schemas.

The fake module enables declarative fake data generation from TypeBox schemas, making it easy to create
realistic test data, seed databases, or generate mock responses. It intelligently uses property key names
to generate contextually appropriate data (e.g., "email" generates an email address, "firstName" generates
a first name).

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### FakeProvider

Faker locale to use for generating fake data.
  @default "en"
  /
  locale?: string;

  /**
  Seed for deterministic fake data generation.
  /
  seed?: number;
}

/**
Generate fake data from TypeBox schemas using faker.js.

```ts
const fake = new FakeProvider();
const userSchema = t.object({
  id: t.uuid(),
  name: t.text(),
  email: t.email(),
});
const fakeUser = fake.generate(userSchema);
```
