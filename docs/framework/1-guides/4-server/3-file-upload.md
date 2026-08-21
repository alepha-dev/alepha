# File Upload

Alepha handles `multipart/form-data` uploads through two body schema types.
Multipart parsing is built into `AlephaServer` and active by default.

Which one you declare decides how the bytes reach your handler, and it is the
only decision that really matters here:

| Schema       | Handler receives        | Bytes are                      | Use when                                                               |
| ------------ | ----------------------- | ------------------------------ | ---------------------------------------------------------------------- |
| `z.file()`   | a `FileLike`            | held until the handler returns | you need to read the content more than once, or need its size up front |
| `z.stream()` | the part, consumed once | passed through as they arrive  | the payload is large, or you are forwarding it somewhere else          |

`z.file()` is the convenient one; `z.stream()` is the one that does not put the
payload in memory.

## Defining Upload Endpoints

Use `z.file()` in a body schema. When the body contains a file field, the action
automatically expects `multipart/form-data`:

```typescript check
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

A `z.file()` field arrives as a `FileLike`:

```typescript
interface FileLike {
  name: string; // Original filename
  type: string; // MIME type (e.g. "image/png")
  size: number; // Size in bytes
  lastModified: number; // Timestamp in milliseconds

  stream(): StreamLike; // Read as stream
  arrayBuffer(): Promise<ArrayBuffer>; // Read into memory
  text(): Promise<string>; // Read as text
}
```

**A `z.file()` field is materialised before your handler runs.** `FileLike`
promises to be readable more than once - you can call `text()` and then
`arrayBuffer()` - and honouring that means keeping the bytes. They are held in
memory, not written to a temporary file, and they are released when the request
ends. Nothing persists unless you store it; see [Permanent Storage](#permanent-storage).

That is what the per-file ceiling is protecting, and why a route expecting large
payloads should declare `z.stream()` instead.

> FileLike is a minimal interface inspired by the Web File API.
> It allows to use browser input file directly without mapping!

## Streaming Large Uploads

`z.stream()` hands the bytes over as they arrive, so memory stays flat no matter
how large the payload is:

```typescript check
import { z } from "alepha";
import { $action } from "alepha/server";

class ArchiveController {
  receive = $action({
    method: "POST",
    path: "/archive",
    schema: {
      body: z.object({
        file: z.stream({ maxBytes: 500_000_000 }),
      }),
      response: z.object({ bytes: z.integer() }),
    },
    handler: async ({ body }) => {
      let bytes = 0;
      for await (const chunk of body.file.data) {
        bytes += chunk.length;
      }
      return { bytes };
    },
  });
}
```

Three consequences worth knowing before you reach for it:

- **The bytes can be read once.** There is no going back for a second pass.
- **`size` is `0`.** The length is not known until the stream has been read, and
  it is not guessed.
- **Parsing stops at the streamed part.** Whatever follows it in the message is
  never read, because the handler - not the parser - is driving. A client that
  wants other fields honoured must send them _before_ the file. This is inherent
  to streaming, not a limitation of the parser.

Because the handler pulls the bytes, nothing is consumed before
[`$secure`](/docs/guides-server-authentication) has run. On the `z.file()` path
the body is read first, so an unauthenticated caller can spend the budget - see
[Multipart](/docs/guides-server-multipart) for what that means when raising a
limit.

## Size Limits

Defaults, applied to every route:

| Limit             | Default | Counts                                                               |
| ----------------- | ------- | -------------------------------------------------------------------- |
| One file          | 5 MB    | that part's content                                                  |
| Whole request     | 10 MB   | every part's content, **plus** the preamble and every part's headers |
| Parts per request | 10      | every part - text fields as well as files                            |

The last two columns are the ones that surprise. The request budget bounds
_reading_, not delivering: a sender that never emits a boundary costs exactly as
much as one that sends content, so the bytes walked past are billed too. And a
form with three text fields and eight files is eleven parts, not eight.

A route raises its own ceiling by declaring it, in **bytes**:

```typescript
body: z.object({
  video: z.file({ maxBytes: 50_000_000 }),
});
```

And the framework's own upload route takes its ceiling from the `$storage`
bucket the bytes are headed for - which is declared in **megabytes**:

```typescript
uploads = $storage({ maxSize: 100 });
```

The two units differ on purpose, and the unit is in each name rather than only
in the docs. [Multipart](/docs/guides-server-multipart) explains how the three
levels resolve and how to add your own.

A bucket that declares no `maxSize` gets **10 MB**, the documented `$storage`
default - the transport honours it rather than falling back to the 5 MB
application-wide figure.

A file refused for its size answers **413**, whichever layer notices: the
transport before the bytes land, or the bucket while they stream past. A file
refused for its MIME type answers **400** - it would not be accepted at any
size.

## Mixed Fields

Combine file fields with regular form fields in the same schema. Non-file fields
are extracted from the form data and decoded according to their schema type:

```typescript
schema: {
  body: z.object({
    avatar: z.file(),
    username: z.text(),
    bio: z.text().optional(),
  }),
}
```

Fields the schema does not declare are skipped rather than refused: the body is
shaped by the route, and a client sending extra parts is not an error the route
has an opinion about.

## Permanent Storage

An uploaded file lives only for the request. To keep it, store it with
`$storage`:

```typescript check
import type { FileLike } from "alepha";
import { $storage } from "alepha/api/files";

class FileService {
  uploads = $storage();

  async store(file: FileLike): Promise<string> {
    const stored = await this.uploads.upload(file);
    return stored.id;
  }
}
```

`upload()` returns the `files` row - hand `.id` to `GET /api/files/:id`, and
persist it in your own tables. Backends: local filesystem, S3-compatible
services and Cloudflare R2. See [File Storage](/docs/guides-persistence-storage)
for constraints, TTL and querying.
