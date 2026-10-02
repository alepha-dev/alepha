# Alepha - Server Multipart

## Installation

Part of the `alepha` package. Import from `alepha/server/multipart`.

```bash
npm install alepha
```

## Overview

The multipart upload seam: `MultipartStreamParser` (streaming form-data
parsing with per-part caps) and `MultipartCapProvider` (dynamic, per-request
size caps resolved before the first body byte). Most apps never import this
directly - `z.file()` / `z.stream()` route schemas drive it.

## API Reference

### Providers

- [`MultipartCapProvider`](/docs/reference-providers-multipartcapprovider) - Decides how many bytes a given request is allowed to carry.
