import { $inject } from "alepha";
import { $client } from "alepha/server/links";
import { BookOpen } from "lucide-react";

import type { FolioController } from "../../../api/controllers/FolioController.ts";
import EpicFoliosPanel from "../components/folios/epic/EpicFoliosPanel.tsx";
import { useFiledFolios } from "../components/folios/epic/useFiledFolios.ts";
import FolioReferencePreview from "../components/folios/FolioReferencePreview.tsx";
import { useFolioElementImageUpload } from "../components/folios/useFolioElementImageUpload.ts";
import { useFolioReferences } from "../components/folios/useFolioReferences.ts";
import { formatReference } from "../components/shared/element/typedReference.ts";
import { DocumentSinkRegistry } from "../registries/DocumentSinkRegistry.ts";
import { ElementReferenceRegistry } from "../registries/ElementReferenceRegistry.ts";
import { ProjectShellRegistry } from "../registries/ProjectShellRegistry.ts";
import { ResourceTabRegistry } from "../registries/ResourceTabRegistry.ts";
import { hasCapability } from "../services/projectCapabilities.ts";
import { canInProject } from "../services/projectRank.ts";

/**
 * Knowledge's part of the project shell, registered on core's
 * `ProjectShellRegistry` (#E75, #Q2624): the Folios entry, the Folios
 * settings section, New folio, the folio breadcrumb leaf, the folio
 * `[[...]]` references, folios as where a generated document is saved, and
 * the Folios tab on an epic.
 */
export class KnowledgeShell {
  protected readonly shell = $inject(ProjectShellRegistry);
  protected readonly references = $inject(ElementReferenceRegistry);
  protected readonly documents = $inject(DocumentSinkRegistry);
  protected readonly tabs = $inject(ResourceTabRegistry);
  protected readonly folioApi = $client<FolioController>();

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

    // First in the picker: notes cite notes.
    this.references.register({
      kind: "folio",
      order: 10,
      brokenKey: "folios.wikilink.broken.folioNotFound",
      href: (projectSlug, ref) => `/${projectSlug}/folios/${ref.number}`,
      match: (path, projectSlug) => {
        const match = /^\/([^/]+)\/folios\/(\d+)(?:[#?]|$)/.exec(path);
        return match && match[1] === projectSlug ? match[2] : undefined;
      },
      preview: FolioReferencePreview,
      useReferences: useFolioReferences,
      useImageUpload: useFolioElementImageUpload,
    });

    // A release's changelog, saved as a folio.
    this.documents.register({
      key: "folio",
      can: () => this.folioApi.create.can(),
      save: async (document) => {
        await this.folioApi.create({ body: document });
      },
    });

    // An epic files folios: a tab on its page, after Flow.
    this.tabs.register({
      resource: "epic",
      key: "folios",
      order: 40,
      labelKey: "epic.tab.folios",
      icon: BookOpen,
      useCollection: useFiledFolios,
      component: EpicFoliosPanel,
    });
  }
}
