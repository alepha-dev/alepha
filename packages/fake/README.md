# Alepha Fake

Generate fake data from TypeBox schemas using faker.js

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides fake data generation capabilities for Alepha applications using faker.js and TypeBox schemas.

The fake module enables declarative fake data generation from TypeBox schemas, making it easy to create
realistic test data, seed databases, or generate mock responses. It intelligently uses property key names
to generate contextually appropriate data (e.g., "email" generates an email address, "firstName" generates
a first name).

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaFake } from "alepha/fake";

const alepha = Alepha.create()
	.with(AlephaFake);

run(alepha);
```

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
