# FileAccessProvider

## Import

```typescript
import { FileAccessProvider } from "alepha/api/files";
```

## Overview

Authorization policy for file reads served through `FileController.streamFile`.

Default: the caller must be the uploader (`file.creator === user.id`). Any
other access path - public buckets, shared attachments, avatars - must be
opted in by overriding this provider in the consuming app:

```ts
class MyAccess extends FileAccessProvider {
  async assertReadable(file, user) {
    if (file.bucket === "avatars") return; // public
    if (file.bucket === "campaign-icons")
      return this.checkCampaignVisible(file, user);
    return super.assertReadable(file, user);
  }
}
Alepha.create().with({ provide: FileAccessProvider, use: MyAccess });
```

Why this exists: prior to introducing this gate, `streamFile` only required
the framework-wide `file:read` permission. The default `user` role grants
`*`, so every authenticated user could download any file by UUID - turning
the 128-bit id into the sole security boundary across tenants.
