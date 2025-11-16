# Alepha @bucket Vercel

Vercel Blob Storage implementation for the bucket file storage.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Plugin for Alepha Bucket that provides Vercel Blob Storage capabilities.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { Alepha@bucketVercel } from "alepha/bucket/vercel";

const alepha = Alepha.create()
	.with(Alepha@bucketVercel);

run(alepha);
```

## API Reference

### Providers

Providers are classes that encapsulate specific functionality and can be injected into your application. They handle initialization, configuration, and lifecycle management.

For more details, see the [Providers documentation](/docs/providers).

#### VercelFileStorageProvider

Vercel Blob Storage implementation of File Storage Provider.
