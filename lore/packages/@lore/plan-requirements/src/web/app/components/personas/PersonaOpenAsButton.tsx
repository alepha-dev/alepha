import { Button } from "@alepha/ui";
import { currentProjectAtom, type I18n } from "@lore/core/web";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { ExternalLink } from "lucide-react";

import type { PersonaInsightController } from "../../../../api/controllers/PersonaInsightController.ts";
import type { PersonaAppCopy } from "../../../../api/schemas/personaInsightSchemas.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";

export interface PersonaOpenAsButtonProps {
  persona: PersonaResource;
  className?: string;
}

/**
 * Open as, on a persona card: opens the persona's app copy in a new tab,
 * as the persona page's button does, under the same query key so the two
 * share one answer. Disabled on production, where Lore signs no one in;
 * absent while the persona has no app copy to open.
 */
const PersonaOpenAsButton = (props: PersonaOpenAsButtonProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const insightApi = useClient<PersonaInsightController>();
  const projectId = project?.id ?? 0;
  const persona = props.persona;
  const appCopy = useQuery<PersonaAppCopy>(
    {
      key: [
        "persona-app-copy",
        projectId,
        persona.number,
        persona.environmentApp ?? "",
        persona.environmentEnv ?? "",
      ],
      enabled: projectId > 0,
      handler: async () =>
        await insightApi.getPersonaAppCopy({
          params: { projectId, number: persona.number },
        }),
    },
    [
      insightApi,
      projectId,
      persona.number,
      persona.environmentApp,
      persona.environmentEnv,
    ],
  );
  const copy = appCopy.data;
  if (copy?.state !== "ready" && copy?.state !== "production") return null;
  const url = copy.state === "ready" ? copy.url : undefined;
  return (
    <Button
      variant="outlined"
      className={props.className}
      disabled={!url}
      title={tr(
        url
          ? "requirements.persona.openAs.help"
          : "requirements.persona.openAs.production",
      )}
      onClick={() => {
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      }}
    >
      <ExternalLink className="size-4" />
      {tr("requirements.persona.card.openAs")}
    </Button>
  );
};

export default PersonaOpenAsButton;
