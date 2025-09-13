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

Provides file storage capabilities through declarative bucket descriptors with support for multiple storage backends.

The bucket module enables unified file operations across different storage systems using the `$bucket` descriptor
on class properties. It abstracts storage provider differences, offering consistent APIs for local filesystem,
cloud storage, or in-memory storage for testing environments.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaBucket } from "alepha/bucket";

const alepha = Alepha.create()
	.with(AlephaBucket);

run(alepha);
```

## API Reference

### Descriptors

Descriptors are functions that define and configure various aspects of your application. They follow the convention of starting with `$` and return configured descriptor instances.

#### $bucket()

Create a container for storing files.

```ts
import { $bucket } from "@alepha/bucket";

class App {
  images = $bucket();

  uploadImage(file: FileLike): Promise<string> {
    return this.images.upload(file);
  }
}
```
