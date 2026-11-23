import { $inject, z } from "alepha";
import { $job } from "alepha/api/jobs";
import { $repository } from "alepha/orm";

import { codeBlameCache } from "../entities/codeBlameCache.ts";
import { codeRepositories } from "../entities/codeRepositories.ts";
import { CodeBlameService } from "../services/CodeBlameService.ts";

/**
 * `code.blame` (#Q4138): finishes a blame the request left `pending`, up to
 * `CodeBlameService.MAX_STEPS`. Pushed under the key
 * `code.blame:<cache row id>`, so one walk runs per file and commit.
 */
export class CodeBlameJobs {
  protected readonly blames = $inject(CodeBlameService);
  protected readonly rows = $repository(codeBlameCache);
  protected readonly repositories = $repository(codeRepositories);

  public readonly finish = $job({
    name: "code.blame",
    description: "Finishes a long blame the page started.",
    schema: z.object({ id: z.uuid() }),
    timeout: [10, "minutes"],
    retry: { retries: 2 },
    handler: async ({ payload }) => {
      const row = await this.rows.findById(payload.id);
      if (!row || row.status !== "pending") return;
      const repository = await this.repositories.findById(row.repositoryId);
      if (!repository) return;
      await this.blames.resume(repository, row);
    },
  });

  public async start(id: string): Promise<void> {
    await this.finish.push({ id }, { key: `code.blame:${id}` });
  }
}
