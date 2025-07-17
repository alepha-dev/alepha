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

## API Reference

### Descriptors

#### $bucket()

Store files in a bucket. WIP
