# File Storage

File uploads are one of those features that seem simple until you actually implement them. MIME type validation, size limits, cloud storage integration, signed URLs...

Alepha provides `$bucket` to handle all of it.

## Defining a Bucket

A bucket is a storage location with rules:

```typescript
import { $bucket } from "alepha/bucket";

class MediaService {
  // profile pictures: images only, 5MB max
  avatars = $bucket({
    name: "avatars",
    mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 5, // megabytes
  });

  // documents: PDFs and office files, 50MB max
  documents = $bucket({
    name: "documents",
    mimeTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    maxSize: 50,
  });
}
```

If someone tries to upload a 100MB PDF to avatars, it fails automatically. No manual validation code.

## Uploading Files

### From an Action

```typescript
class AvatarApi {
  media = $inject(MediaService);

  upload = $action({
    method: "POST",
    path: "/avatar",
    schema: {
      body: t.object({
        file: t.file(), // magic: handles multipart/form-data
      }),
      response: t.object({
        fileId: t.text(),
      }),
    },
    handler: async ({ body }) => {
      // body.file is already validated (size, mime type)
      const fileId = await this.media.avatars.upload(body.file);
      return { fileId };
    },
  });
}
```

That `t.file()` in the schema tells Alepha to parse multipart form data. The file arrives validated and ready.

### From Server Code

```typescript
// upload from a buffer
const fileId = await this.avatars.upload({
  buffer: Buffer.from("..."),
  name: "photo.jpg",
  type: "image/jpeg",
});

// upload from a URL (downloads and stores)
const fileId = await this.avatars.upload({
  url: "https://example.com/photo.jpg",
});
```

## Downloading Files

```typescript
class AvatarApi {
  download = $action({
    path: "/avatar/:id",
    schema: {
      params: t.object({ id: t.text() }),
    },
    handler: async ({ params }) => {
      const file = await this.media.avatars.download(params.id);

      if (!file) {
        throw HttpError.notFound("Avatar not found");
      }

      // return the file directly - Alepha sets correct headers
      return file;
    },
  });
}
```

The response automatically includes:
- `Content-Type` from the stored file
- `Content-Disposition` with the filename
- Proper streaming for large files

## Deleting Files

```typescript
await this.media.avatars.delete(fileId);
```

Simple.

## Storage Backends

By default, Alepha stores files on the local filesystem (great for development). In production, you probably want cloud storage.

### Local Storage (Default)

```typescript
// files stored in ./storage/avatars/
const avatars = $bucket({ name: "avatars" });
```

### Azure Blob Storage

```typescript
import { AzureFileStorageProvider } from "@alepha/bucket-azure";

const alepha = Alepha.create()
  .with({ provide: FileStorageProvider, use: AzureFileStorageProvider });

// set AZURE_STORAGE_CONNECTION_STRING in your environment
```

### Vercel Blob

```typescript
import { VercelFileStorageProvider } from "@alepha/bucket-vercel";

const alepha = Alepha.create()
  .with({ provide: FileStorageProvider, use: VercelFileStorageProvider });

// set BLOB_READ_WRITE_TOKEN in your environment
```

Your bucket code stays the same. Only the provider changes.

## Signed URLs

For large files, you might want clients to upload directly to cloud storage:

```typescript
// get a signed URL for direct upload
const { url, fileId } = await this.avatars.createUploadUrl({
  expiresIn: [15, "minutes"],
  maxSize: 5,
});

// client uploads directly to this URL
// then confirms with your server
await this.avatars.confirmUpload(fileId);
```

This offloads bandwidth from your server to the cloud provider.

## File Metadata

Get info about stored files:

```typescript
const metadata = await this.avatars.metadata(fileId);

// {
//   id: "abc123",
//   name: "profile.jpg",
//   size: 245678,
//   mimeType: "image/jpeg",
//   createdAt: Date,
// }
```

## Complete Upload Flow Example

Here's a real-world profile picture upload:

```typescript
class ProfileApi {
  media = $inject(MediaService);
  users = $inject(UserService);

  uploadAvatar = $action({
    method: "POST",
    path: "/profile/avatar",
    secure: true, // requires authentication
    schema: {
      body: t.object({ file: t.file() }),
      response: t.object({ avatarUrl: t.text() }),
    },
    handler: async ({ body, user }) => {
      // delete old avatar if exists
      if (user.avatarId) {
        await this.media.avatars.delete(user.avatarId);
      }

      // upload new one
      const fileId = await this.media.avatars.upload(body.file);

      // update user record
      await this.users.update(user.id, { avatarId: fileId });

      // return the download URL
      return {
        avatarUrl: `/api/avatar/${fileId}`,
      };
    },
  });
}
```

## Comparison: Multer vs Alepha

**Express + Multer:**
```typescript
// configure multer
const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only images allowed"));
    }
    cb(null, true);
  },
  storage: multer.diskStorage({
    destination: "./uploads",
    filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
  }),
});

// use in route
app.post("/avatar", upload.single("file"), (req, res) => {
  // manually handle cloud upload if needed
  // manually clean up old files
  // manually set response headers for download
});
```

**Alepha:**
```typescript
// define once
avatars = $bucket({
  name: "avatars",
  mimeTypes: ["image/*"],
  maxSize: 5,
});

// use
const fileId = await this.avatars.upload(body.file);
```

Less code. Automatic validation. Swappable storage backends.

## Tips

1. **Use specific MIME types** - `image/jpeg` is safer than `image/*`
2. **Set reasonable size limits** - Don't trust the client
3. **Store file IDs, not URLs** - URLs change, IDs don't
4. **Delete orphaned files** - Clean up when records are deleted
5. **Use signed URLs for large files** - Save server bandwidth

## Summary

| Need | Solution |
|------|----------|
| Define storage with rules | `$bucket({ name, mimeTypes, maxSize })` |
| Accept file in action | `t.file()` in schema |
| Upload file | `bucket.upload(file)` |
| Download file | `bucket.download(fileId)` |
| Delete file | `bucket.delete(fileId)` |
| Use cloud storage | Swap the provider |

File storage shouldn't require a week of setup. Define your bucket, upload files, move on.
