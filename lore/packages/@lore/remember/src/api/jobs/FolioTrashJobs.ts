import { projects } from "@lore/core/schemas";
import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { $repository } from "alepha/orm";

import { FolioTrashService } from "../services/FolioTrashService.ts";

/**
 * The folio trash's nightly sweep (#Q3659): every project gets its trash
 * (the directory list also makes it on demand), then what has sat in a
 * trash for 30 days is deleted for good.
 */
export class FolioTrashJobs {
  protected readonly projects = $repository(projects);
  protected readonly trash = $inject(FolioTrashService);

  public readonly emptyTrash = $job({
    name: "folios.empty-trash",
    description:
      "Gives every project its folio trash, and deletes for good what has sat in it for 30 days.",
    cron: "30 3 * * *",
    timeout: [5, "minutes"],
    retry: { retries: 2 },
    handler: async () => {
      for (const project of await this.projects.findMany({
        columns: ["id"],
      })) {
        await this.trash.ensure(project.id);
      }
      await this.trash.purge();
    },
  });
}
