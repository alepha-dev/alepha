# Alepha - Server Multipart

## Installation

Part of the `alepha` package. Import from `alepha/server/multipart`.

```bash
npm install alepha
```

## Overview

| type | quality | stability |
|------|---------|-----------|
| backend | standard | stable |

Multipart form data handling for file uploads.

**Features:**
- File upload parsing
- Form field extraction

## API Reference

### Environment Variables

Environment variables used to configure this module. These can be set in your `.env` file or through your deployment configuration.

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `SERVER_MULTIPART_FILE_COUNT` | integer | 10 | Maximum number of files allowed in a single request. |
| `SERVER_MULTIPART_FILE_LIMIT` | integer | 5_000_000 | Maximum size of a single file in bytes. |
| `SERVER_MULTIPART_LIMIT` | integer | 10_000_000 | Maximum total size of multipart request body in bytes. |
