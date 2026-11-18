import {
  useAlepha,
  useClient,
  useQuery,
  useQueryClient,
  useStore,
} from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { AutomationController } from "../../../../../api/controllers/AutomationController.ts";
import { automationDraftAtom } from "../../../atoms/automationDraftAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";
import { usePageCrumb } from "../../shared/usePageCrumb.ts";
import AutomationPage from "./AutomationPage.tsx";
import AutomationOutlineEditor from "./outline/AutomationOutlineEditor.tsx";

export interface AutomationNewPageProps {
  /**
   * The preset opened in the editor, whose graph `automationDraftAtom`
   * holds.
   */
  preset?: string;
}

/**
 * A new automation built in the outline editor (#Q3812, #Q3848): empty on
 * "Choose what starts it" (Start from scratch), or a preset's graph as an
 * unsaved draft (Open in editor). The first save creates it, disabled, and
 * lands on its page, where it is tested and enabled.
 */
const AutomationNewPage = (props: AutomationNewPageProps) => {
  const [project] = useStore(currentProjectAtom);
  const api = useClient<AutomationController>();
  const queries = useQueryClient();
  const router = useRouter();
  const alepha = useAlepha();
  const { tr } = useI18n<I18n, "en">();
  usePageCrumb("projectAutomationNew", tr("automation.new"));
  // Read once: the draft is this page's to own from here.
  const [initial] = useState(() => {
    const draft = alepha.store.get(automationDraftAtom);
    alepha.store.set(automationDraftAtom, undefined);
    return draft && draft.preset === props.preset
      ? { title: draft.title, rule: draft.rule }
      : undefined;
  });
  const catalog = useQuery(
    {
      key: ["automation-catalog", project?.id],
      enabled: !!project,
      handler: ({ signal }) =>
        api.getAutomationCatalog(
          { params: { projectId: project!.id } },
          { request: { signal } },
        ),
    },
    [project?.id],
  );
  if (!project) return null;
  return (
    <AutomationPage
      wide
      title={tr("automation.new")}
      description={tr("automation.outline.newDescription")}
    >
      {catalog.data ? (
        <AutomationOutlineEditor
          initial={initial}
          catalog={catalog.data}
          onSaved={(created) => {
            queries.invalidate(["automations", project.id]);
            void router.push("projectAutomationDetail", {
              params: { projectSlug: project.slug, automationId: created.id },
            });
          }}
          onClose={() =>
            void router.push("projectAutomationGallery", {
              params: { projectSlug: project.slug },
            })
          }
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          {tr("automation.editor.loading")}
        </p>
      )}
    </AutomationPage>
  );
};

export default AutomationNewPage;
