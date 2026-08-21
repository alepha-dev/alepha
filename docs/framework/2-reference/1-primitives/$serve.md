# $serve

## Import

```typescript
import { $serve } from "alepha/server/static";
```

## Overview

Create a new static file handler.

## Options

| Option               | Type                                          | Required | Description                                                          |
| -------------------- | --------------------------------------------- | -------- | -------------------------------------------------------------------- |
| `path`               | `string`                                      | No       | Prefix for the served path.                                          |
| `root`               | `string`                                      | No       | Path to the directory to serve.                                      |
| `disabled`           | `boolean`                                     | No       | If true, primitive will be ignored.                                  |
| `ignoreDotEnvFiles`  | `boolean`                                     | No       | Whether to exclude dot files (e.g                                    |
| `indexFallback`      | `boolean`                                     | No       | Whether to use the index.html file when the path is a directory.     |
| `historyApiFallback` | `boolean`                                     | No       | Force all requests "not found" to be served with the index.html file |
| `name`               | `string`                                      | No       | Optional name of the primitive                                       |
| `cacheControl`       | `Partial&lt;CacheControlOptions&gt; \| false` | No       | Cache-control configuration                                          |
| `silent`             | `boolean`                                     | No       | Whether to suppress logging for this primitive.                      |
