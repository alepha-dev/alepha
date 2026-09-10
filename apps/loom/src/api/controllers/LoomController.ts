import { $inject, z } from "alepha";
import { $action } from "alepha/server";

import { projectCreateSchema } from "../schemas/projectCreateSchema.ts";
import { projectSchema } from "../schemas/projectSchema.ts";
import { projectStateSchema } from "../schemas/projectStateSchema.ts";
import { ProjectStateService } from "../services/ProjectStateService.ts";
import { ProjectStore } from "../services/ProjectStore.ts";

/**
 * Loom's API: the project list, and one project's state.
 *
 * ⚠️ There is no authentication, and that is deliberate for now: Loom binds
 * `localhost` and every action here reads, apart from editing the project
 * list. The script runner will change that, since running a command is not
 * something any page open in the same browser should be able to ask for.
 */
export class LoomController {
  protected readonly store = $inject(ProjectStore);
  protected readonly state = $inject(ProjectStateService);

  listProjects = $action({
    path: "/projects",
    schema: {
      response: z.array(projectSchema),
    },
    handler: () => this.store.list(),
  });

  addProject = $action({
    method: "POST",
    path: "/projects",
    schema: {
      body: projectCreateSchema,
      response: projectSchema,
    },
    handler: ({ body }) => this.store.add(body),
  });

  removeProject = $action({
    method: "DELETE",
    path: "/projects/:id",
    schema: {
      params: z.object({ id: z.text() }),
      response: z.object({ removed: z.string() }),
    },
    handler: async ({ params }) => {
      await this.store.remove(params.id);
      return { removed: params.id };
    },
  });

  getProjectState = $action({
    path: "/projects/:id/state",
    schema: {
      params: z.object({ id: z.text() }),
      response: projectStateSchema,
    },
    handler: async ({ params }) =>
      this.state.collect(await this.store.get(params.id)),
  });
}
