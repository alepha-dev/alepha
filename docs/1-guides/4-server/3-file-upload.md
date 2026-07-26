# File Upload

Alepha handles multipart/form-data uploads through the `z.file()` schema type. Multipart parsing is built into `AlephaServer` and active by default.

## Defining Upload Endpoints

Use `z.file()` in a body schema. When the body contains a file field, the action automatically expects `multipart/form-data`:

```typescript
import { z } from "alepha";
import { $action } from "alepha/server";
import { $storage } from "alepha/api/files";

class UploadController {
  uploads = $storage();

  upload = $action({
    method: "POST",
    path: "/upload",
    schema: {
      body: z.object({
        file: z.file(),
        description: z.text().optional(),
      }),
      response: z.object({ id: z.text() }),
    },
    handler: async ({ body, user }) => {
      const stored = await this.uploads.upload(body.file, { user });
      return { id: stored.id };
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
  body: z.object({
    avatar: z.file(),
    username: z.text(),
    bio: z.text().optional(),
  }),
}
```

## Permanent Storage

Temporary files are deleted after the request completes. To keep files permanently, store them with `$storage`:

```typescript
import { $storage } from "alepha/api/files";

class FileService {
  uploads = $storage();

  async store(file: FileLike): Promise<string> {
    const stored = await this.uploads.upload(file);
    return stored.id;
  }
}
```

`upload()` returns the `files` row — hand `.id` to `GET /api/files/:id`, and
persist it in your own tables. Backends: local filesystem, S3-compatible
services and Cloudflare R2. See [File Storage](/docs/guides-persistence-storage)
for constraints, TTL and querying.
