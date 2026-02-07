# File Upload

Alepha handles multipart/form-data uploads through the `t.file()` schema type and the `AlephaServerMultipart` module.

## Setup

Register the multipart module:

```typescript
import { Alepha } from "alepha";
import { AlephaServerMultipart } from "alepha/server/multipart";

Alepha.create()
  .with(AlephaServerMultipart)
  .with(App)
  .start();
```

## Defining Upload Endpoints

Use `t.file()` in a body schema. When the body contains a file field, the action automatically expects `multipart/form-data`:

```typescript
import { t } from "alepha";
import { $action } from "alepha/server";
import { $bucket } from "alepha/bucket";

class UploadController {
  bucket = $bucket();

  upload = $action({
    method: "POST",
    path: "/upload",
    schema: {
      body: t.object({
        file: t.file(),
        description: t.optional(t.text()),
      }),
      response: t.object({ id: t.text() }),
    },
    handler: async ({ body }) => {
      const fileId = await this.bucket.upload(body.file);
      return { id: fileId };
    },
  });
}
```

## File Object

The uploaded file implements the `FileLike` interface:

```typescript
interface FileLike {
  name: string;           // Original filename
  type: string;           // MIME type (e.g. "image/png")
  size: number;           // Size in bytes
  lastModified: number;   // Timestamp in milliseconds
  filepath?: string;      // Temporary file path on disk

  stream(): StreamLike;           // Read as stream
  arrayBuffer(): Promise<ArrayBuffer>;  // Read into memory
  text(): Promise<string>;        // Read as text
}
```

During the request, uploaded files are written to temporary files in the OS temp directory. They are automatically cleaned up after the response is sent. This approach keeps memory usage low for large files.

> FileLike is a minimal interface inspired by the Web File API.
> It allows to use browser input file directly without mapping!

## Mixed Fields

Combine file fields with regular form fields in the same schema. Non-file fields are extracted from the form data and decoded according to their schema type:

```typescript
schema: {
  body: t.object({
    avatar: t.file(),
    username: t.text(),
    bio: t.optional(t.text()),
  }),
}
```

## Permanent Storage

Temporary files are deleted after the request completes. To keep files permanently, store them using `$bucket`:

```typescript
import { $bucket } from "alepha/bucket";

class FileService {
  bucket = $bucket();

  async store(file: FileLike): Promise<string> {
    return await this.bucket.upload(file);
  }
}
```

`$bucket` supports multiple backends: S3, Cloudflare R2, Vercel Blob, and local filesystem.
