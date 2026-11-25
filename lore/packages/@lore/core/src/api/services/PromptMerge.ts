import { $inject } from "alepha";

import { prompts } from "../entities/prompts.ts";
import { ProjectMergeService } from "./ProjectMergeService.ts";
import {
  type ProjectMergeTable,
  ProjectMergeTables,
} from "./ProjectMergeTables.ts";

/**
 * Prompts move with a merged project (#Q4274), as a merge step of their own
 * since #E175, the way chat's rooms do (`ChatRoomMerge`): the step moves to
 * `@lore/prompts` with the table.
 *
 * A custom prompt whose name the target uses is renamed `<name>-2`; of two
 * rows configuring the same built-in, the target's stands.
 */
export class PromptMerge {
  protected static readonly moved: ProjectMergeTable = {
    kind: "prompt",
    entity: prompts,
    keys: ["name"],
    onCollision: "rename",
    renamed: (key, count) => `${key.slice(0, 60)}-${count}`,
    read: ["builtin"],
    keepTargetIf: (row) => !!row.builtin,
  };

  protected readonly merge = $inject(ProjectMergeService);
  protected readonly tables = $inject(ProjectMergeTables);

  constructor() {
    this.tables.prepare([PromptMerge.moved]);
    this.merge.registerStep({
      // After core's step (5), which brings the source's capabilities over.
      order: 6,
      name: "prompts",
      tables: [prompts.name],
      plan: async (context) => {
        const result = await this.tables.move(context, PromptMerge.moved);
        return {
          moved: { [prompts.name]: result.moved },
          renumbered: [],
          joined: [],
          changed: result.changed,
          conflicts: result.conflicts,
          statements: result.statements,
        };
      },
    });
  }
}
