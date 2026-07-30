import { z } from "alepha";
import { $storage } from "alepha/api/files";
import { $action } from "alepha/server";

/**
 * Blob storage, so the app has files that must survive a redeploy.
 *
 * This is the primitive that proves the framework fix behind `STORAGE_PATH`:
 * the local provider used to default to `node_modules/.alepha/buckets`, which
 * lives INSIDE the deployed bundle — so every redeploy silently destroyed every
 * uploaded file. Uploading here, redeploying, and finding the file still listed
 * is the test that the fix holds.
 *
 * Declaring it is also what puts `resources.hasBucket: true` into the manifest,
 * which is what grants the app write access to `storage/` in its sandbox. Not
 * declaring it denies that access.
 */
export class UploadsApi {
  files = $storage({
    name: "uploads",
    description: "Files uploaded through the demo page",
    maxSize: 5,
  });

  upload = $action({
    method: "POST",
    path: "/uploads",
    description: "Upload a file",
    schema: {
      body: z.object({ file: z.file() }),
      response: z.object({ id: z.text(), name: z.text() }),
    },
    handler: async ({ body }) => {
      const stored = await this.files.upload(body.file);
      return { id: stored.id, name: stored.name ?? body.file.name };
    },
  });

  list = $action({
    method: "GET",
    path: "/uploads",
    description: "List uploaded files",
    schema: {
      response: z.array(z.object({ id: z.text(), name: z.text() })),
    },
    handler: async () => {
      // `list` paginates: the rows are under `content`, not the result itself.
      const found = await this.files.list();
      return found.content.map((f) => ({ id: f.id, name: f.name ?? f.id }));
    },
  });
}
