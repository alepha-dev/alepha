# Alepha Bucket

A universal interface for object and file storage providers.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/bucket
```
## Module

```ts
import { Alepha, run } from "alepha";
import { AlephaBucket } from "alepha/bucket";

const alepha = Alepha.create()
  .with(AlephaBucket);

run(alepha);
```

Alepha Bucket Module

This module provides file storage capabilities using different storage providers.
It includes a default local file storage provider for production and a memory storage provider for testing.
It also provides a $bucket() descriptor provider to manage file buckets.

## API Reference

### Descriptors

#### $bucket()

Store files in a bucket. WIP
