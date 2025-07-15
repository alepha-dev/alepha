# Alepha Server Swagger

Generates OpenAPI documentation and a Swagger UI for APIs.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-swagger
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaServerSwagger } from "alepha/server/swagger";

const alepha = Alepha.create()
  .with(AlephaServerSwagger);

run(alepha);
```

Alepha Server Swagger Module

Plugin for Alepha Server that provides Swagger documentation capabilities.
It generates OpenAPI v3 documentation for the server's endpoints ($action).
It also provides a Swagger UI for interactive API documentation.

## API Reference

### Descriptors

#### $swagger()

Create a new OpenAPI.
