import { $inject, z } from "alepha";
import {
  fileQuerySchema,
  fileResourceSchema,
  storageStatsSchema,
} from "alepha/api/files";
import { $action } from "alepha/server";

import { ShowcaseFiles } from "./ShowcaseFiles.ts";

/**
 * Stands in for `FileController` and `AdminFileStatsController`.
 *
 * `AdminFiles` holds two clients, one per controller: the listing comes from
 * the file controller and the bucket filter from the stats one. Both halves
 * are declared here because a container has one flat action namespace.
 *
 * ⚠️ `uploadFile` accepts a real multipart body and stores nothing. It has to
 * accept it: the component posts a file and awaits the response before
 * refetching, so refusing the call would leave the upload button spinning.
 */
export class ShowcaseFilesController {
  protected readonly files = $inject(ShowcaseFiles);

  public readonly findFiles = $action({
    path: "/admin/files",
    schema: {
      query: fileQuerySchema,
      response: z.page(fileResourceSchema),
    },
    handler: ({ query }) => this.files.paginate(query as any),
  });

  /**
   * Feeds the bucket filter. `AdminFiles` swallows a failure here
   * (`onError: () => {}`), so an absent fixture renders an empty filter with
   * no error anywhere.
   */
  public readonly getFileStats = $action({
    path: "/admin/files/stats",
    schema: {
      response: storageStatsSchema,
    },
    handler: () => this.files.stats(),
  });

  public readonly uploadFile = $action({
    method: "POST",
    path: "/files",
    schema: {
      body: z.record(z.text(), z.any()),
      response: fileResourceSchema,
    },
    handler: () => this.files.rows()[0] as any,
  });

  public readonly deleteFile = $action({
    method: "DELETE",
    path: "/files/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ ok: z.boolean() }),
    },
    handler: () => ({ ok: true }),
  });

  public readonly deleteFiles = $action({
    method: "DELETE",
    path: "/files",
    schema: {
      body: z.object({ ids: z.array(z.text()) }),
      response: z.object({ deleted: z.integer() }),
    },
    handler: ({ body }) => ({ deleted: body.ids.length }),
  });
}
