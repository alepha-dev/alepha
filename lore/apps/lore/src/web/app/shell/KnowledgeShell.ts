import { $inject } from "alepha";
import { BookOpen } from "lucide-react";

import { formatReference } from "../components/shared/element/typedReference.ts";
import { ProjectShellRegistry } from "../registries/ProjectShellRegistry.ts";
import { hasCapability } from "../services/projectCapabilities.ts";
import { canInProject } from "../services/projectRank.ts";

/**
 * Knowledge's part of the project shell, registered on core's
 * `ProjectShellRegistry` (#E75, #Q2624): the Folios entry, the Folios
 * settings section, New folio and the folio breadcrumb leaf.
 */
export class KnowledgeShell {
  protected readonly shell = $inject(ProjectShellRegistry);

  constructor() {
    this.shell.registerNav("knowledge", [
      {
        route: "projectFolios",
        permission: "folio:read",
        labelKey: "project.menu.folios",
        icon: BookOpen,
        group: "record",
        order: 10,
        activeOn: (name) => name.startsWith("projectFolios"),
      },
    ]);

    this.shell.registerSettings({
      key: "knowledge",
      order: 40,
      labelKey: "project.menu.folios",
      descriptionKey: "project.settings.section.knowledge",
      icon: BookOpen,
      capability: "knowledge",
      tabs: [
        {
          route: "projectSettingsKnowledge",
          labelKey: "project.settings.tab.features",
        },
      ],
    });

    this.shell.registerCreate({
      key: "folio",
      order: 50,
      labelKey: "project.menu.create-folio",
      icon: BookOpen,
      enabled: (project) =>
        hasCapability(project, "knowledge") &&
        canInProject(project, "folio:write"),
      route: "projectFoliosNew",
    });

    // The folio DETAIL page contributes `#F12`, the same shape as the epic
    // and quest leaves (feedback #P2137): the title heads the document
    // immediately under this bar, and it used to be spelled out here after
    // every directory it sits in, which is a bar made of one title.
    //
    // Read from the route params, not from an atom: the URL already carries
    // the number, so this leaf cannot lag a loader.
    //
    // ⚠️ The directory chain is DROPPED, and that is a real capability going
    // rather than only noise: its segments carried `?dir=<shortId>`. The tree
    // pane beside the document is the way back up the tree now.
    this.shell.registerCrumb({
      order: 50,
      crumb: (ctx) =>
        ctx.routeName === "projectFoliosFolio" && ctx.params.shortId
          ? { label: formatReference("folio", Number(ctx.params.shortId)) }
          : undefined,
    });
  }
}
