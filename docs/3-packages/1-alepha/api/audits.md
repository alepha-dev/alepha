# Alepha - Api Audits

## Installation

Part of the `alepha` package. Import from `alepha/api/audits`.

```bash
npm install alepha
```

## Overview

Audit trail for compliance.

**Features:**
- Domain-specific audit types
- Audit event logging
- Filtering and searching
- User action tracking
- Retention policy with a default + per-type TTL ({@link AuditParameters}, {@link AuditJobs})

## API Reference

### Primitives

- [`$audit`](/docs/reference-primitives-$audit) — Create an audit type primitive.
