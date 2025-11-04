# Alepha File

Helpers for creating and managing file-like objects seamlessly.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

Provides file system capabilities for Alepha applications with support for multiple file sources and operations.

The file module enables working with files from various sources (URLs, buffers, streams) and provides
utilities for file type detection, content type determination, and common file system operations.

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaFile } from "alepha/file";

const alepha = Alepha.create()
	.with(AlephaFile);

run(alepha);
```
