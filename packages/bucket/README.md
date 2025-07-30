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

Triggered when a file is uploaded to a bucket.
		Can be used to perform actions after a file is uploaded, like creating a database record!

## API Reference

### Descriptors

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
