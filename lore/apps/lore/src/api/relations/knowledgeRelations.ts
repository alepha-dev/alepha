import { users } from "alepha/api/users";
import { $relations } from "alepha/orm";

import { folioAttachments } from "../entities/folioAttachments.ts";
import { folioDirectories } from "../entities/folioDirectories.ts";
import { folioRevisions } from "../entities/folioRevisions.ts";
import { folios } from "../entities/folios.ts";
import { projects } from "../entities/projects.ts";

/**
 * Knowledge's entity graph: folios, their revisions, directories and
 * attachments, and the core tables (users, projects) they point at. See
 * `coreRelations` for why the graph is one value per module.
 *
 * Links are core's (`folio_links`), and polymorphic on both ends: they are
 * read through `ResourceLinkService`, never joined here.
 */
const schema = {
  users,
  projects,
  folios,
  folioRevisions,
  folioDirectories,
  folioAttachments,
};

export const knowledgeRelations = $relations(schema, (r) => ({
  folios: {
    project: r.one.projects({
      from: r.folios.projectId,
      to: r.projects.id,
    }),
    directory: r.one.folioDirectories({
      from: r.folios.directoryId,
      to: r.folioDirectories.id,
    }),
    revisions: r.many.folioRevisions({
      from: r.folios.id,
      to: r.folioRevisions.folioId,
    }),
    attachments: r.many.folioAttachments({
      from: r.folios.id,
      to: r.folioAttachments.folioId,
    }),
  },

  folioRevisions: {
    folio: r.one.folios({ from: r.folioRevisions.folioId, to: r.folios.id }),
    author: r.one.users({ from: r.folioRevisions.byUserId, to: r.users.id }),
  },

  folioDirectories: {
    project: r.one.projects({
      from: r.folioDirectories.projectId,
      to: r.projects.id,
    }),
    parent: r.one.folioDirectories({
      from: r.folioDirectories.parentId,
      to: r.folioDirectories.id,
    }),
    children: r.many.folioDirectories({
      from: r.folioDirectories.id,
      to: r.folioDirectories.parentId,
    }),
    folios: r.many.folios({
      from: r.folioDirectories.id,
      to: r.folios.directoryId,
    }),
  },

  folioAttachments: {
    project: r.one.projects({
      from: r.folioAttachments.projectId,
      to: r.projects.id,
    }),
    folio: r.one.folios({
      from: r.folioAttachments.folioId,
      to: r.folios.id,
    }),
  },
}));
