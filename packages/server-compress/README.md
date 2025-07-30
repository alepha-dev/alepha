# Alepha Server Compress

Gzip and Brotli compression for server responses.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

Alternatively, you can install it individually:

```bash
npm install @alepha/core @alepha/server-compress
```

## Module

Plugin for Alepha Server that provides server-side compression capabilities.

Compresses responses using gzip, brotli, or zstd based on the `Accept-Encoding` header.
