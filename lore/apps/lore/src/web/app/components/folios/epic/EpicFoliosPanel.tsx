import { useDialog } from "@alepha/ui";
import { useAction, useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { ResourceFilingController } from "@/api/controllers/ResourceFilingController.ts";
import type { FolioResource } from "@/api/schemas/folioResourceSchema.ts";

import type { ResourceTabSubject } from "../../../registries/ResourceTabRegistry.ts";
import type { I18n } from "../../../services/I18n.ts";
import EpicFoliosList from "./EpicFoliosList.tsx";
import { useFiledFolios } from "./useFiledFolios.ts";

export interface EpicFoliosPanelProps {
  subject: ResourceTabSubject;
}

/**
 * The epic page's Folios tab, registered by `KnowledgeShell` (#E75,
 * #Q2624). Filing goes through core's `ResourceFilingController`, which
 * hands it to the epic's own action, gate and audit included: Knowledge
 * never reaches the epic's code.
 */
const EpicFoliosPanel = (props: EpicFoliosPanelProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const filingApi = useClient<ResourceFilingController>();
  const { subject } = props;
  const { folios } = useFiledFolios(subject);
  const foliosKey = ["folios", subject.projectId, { epicId: subject.id }];

  // One `useAction` per write. A refusal is the server's sentence, toasted
  // by the root `ActionErrorToaster`; the detach confirmation lives in its
  // handler, so backing out sends nothing.
  const attach = useAction<[folioId: string], void>(
    {
      handler: async (folioId) => {
        await filingApi.fileResource({
          params: { kind: "epic", id: subject.id },
          body: { childKind: "folio", childId: folioId },
        });
      },
      invalidates: [foliosKey],
    },
    [filingApi, subject.id],
  );

  const detach = useAction<[folio: FolioResource], void>(
    {
      handler: async (folio) => {
        const ok = await dialog.confirm({
          title: tr("epic.folios.detach.title"),
          description: tr("epic.folios.detach.confirm", {
            args: [folio.title],
          }),
          confirmLabel: tr("epic.folios.detach"),
          cancelLabel: tr("common.cancel"),
        });
        if (!ok) return;
        await filingApi.unfileResource({
          params: {
            kind: "epic",
            id: subject.id,
            childKind: "folio",
            childId: folio.id,
          },
        });
      },
      invalidates: [foliosKey],
    },
    [filingApi, subject.id, dialog, tr],
  );

  return (
    <EpicFoliosList
      projectId={subject.projectId}
      folios={folios}
      // Every membership control waits while either write runs, since
      // `run()` drops a call made while its own is in flight.
      busy={attach.loading || detach.loading}
      writable={subject.writable ?? false}
      onAttach={(folioId) => void attach.run(folioId)}
      onDetach={(folio) => void detach.run(folio)}
    />
  );
};

export default EpicFoliosPanel;
