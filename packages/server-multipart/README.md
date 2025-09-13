# Alepha Server Multipart

Handles multipart/form-data requests for file uploads.

## Installation

This package is part of the Alepha framework and can be installed via the all-in-one package:

```bash
npm install alepha
```

## Module

This module provides support for handling multipart/form-data requests.
It allows to parse body data containing t.file().

This module can be imported and used as follows:

```typescript
import { Alepha, run } from "alepha";
import { AlephaServerMultipart } from "alepha/server/multipart";

const alepha = Alepha.create()
	.with(AlephaServerMultipart);

run(alepha);
```
