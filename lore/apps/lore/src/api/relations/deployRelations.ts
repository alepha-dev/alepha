import { projects } from "@lore/core/schemas";
import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";

import { appInstances } from "../entities/appInstances.ts";
import { blightIgnoreRules } from "../entities/blightIgnoreRules.ts";
import { sigils } from "../entities/sigils.ts";

/**
 * Deploy's entity graph: sigils, app instances and blight rules, and the
 * core tables (users, projects) they point at. See `coreRelations` for why
 * the graph is one value per module.
 */
const schema = { users, projects, sigils, appInstances, blightIgnoreRules };

export const deployRelations = $relations(schema, (r) => ({
  sigils: {
    project: r.one.projects({
      from: r.sigils.projectId,
      to: r.projects.id,
    }),
    author: r.one.users({ from: r.sigils.createdBy, to: r.users.id }),
  },

  appInstances: {
    project: r.one.projects({
      from: r.appInstances.projectId,
      to: r.projects.id,
    }),
    sigil: r.one.sigils({ from: r.appInstances.sigilId, to: r.sigils.id }),
    author: r.one.users({ from: r.appInstances.createdBy, to: r.users.id }),
  },

  blightIgnoreRules: {
    project: r.one.projects({
      from: r.blightIgnoreRules.projectId,
      to: r.projects.id,
    }),
    author: r.one.users({
      from: r.blightIgnoreRules.createdBy,
      to: r.users.id,
    }),
  },
}));
