import {
  formatReference,
  type I18n,
  type WikiLinkPreviewProps,
  WikiLinkPreviewState,
} from "@lore/core/web";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { PersonaController } from "../../../../api/controllers/PersonaController.ts";
import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import { PERSONA_KIND_LABEL_KEYS } from "./personaKindLabels.ts";

/**
 * A persona's hover card (#E153): its reference, name, kind and one-line
 * role.
 */
const PersonaReferencePreview = (props: WikiLinkPreviewProps) => {
  const personaApi = useClient<PersonaController>();
  const { tr } = useI18n<I18n, "en">();
  const { projectId, id } = props;

  const query = useQuery<PersonaResource>(
    {
      key: ["wikilink-preview", projectId, `persona:${id}`],
      staleTime: [5, "minutes"],
      handler: async () =>
        await personaApi.getPersonaByNumber({
          params: { projectId, number: Number(id) },
        }),
      onError: () => {},
    },
    [personaApi, projectId, id],
  );

  const persona = query.data;
  if (!persona) return <WikiLinkPreviewState loading={query.loading} />;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-muted-foreground font-mono text-xs">
          {formatReference("persona", persona.number)}
        </span>
        <span className="text-sm font-semibold">{persona.name}</span>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-2 text-xs">
        <span>{tr(PERSONA_KIND_LABEL_KEYS[persona.kind])}</span>
        {persona.role ? <span>· {persona.role}</span> : null}
      </div>
    </div>
  );
};

export default PersonaReferencePreview;
