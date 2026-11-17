import { Badge } from "@alepha/ui";
import { DetailAside, type DetailAsideRow } from "@alepha/ui/shell";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import {
  PERSONA_KIND_ICONS,
  PERSONA_KIND_LABEL_KEYS,
} from "./personaKindLabels.ts";

export interface PersonaAsideProps {
  persona: PersonaResource;
}

/**
 * The persona page's identity card (#E153): its reference, name, kind,
 * Alepha role, demo account, environment, areas and creation date. A row
 * with nothing to say is omitted.
 */
const PersonaAside = (props: PersonaAsideProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  const persona = props.persona;
  const KindIcon = PERSONA_KIND_ICONS[persona.kind];

  const rows: DetailAsideRow[] = [
    {
      label: tr("requirements.persona.aside.id"),
      copy: formatReference("persona", persona.number),
    },
    {
      label: tr("requirements.persona.field.name"),
      value: (
        <span className="text-sm font-medium break-words">{persona.name}</span>
      ),
    },
    {
      label: tr("requirements.persona.field.kind"),
      value: (
        <Badge variant="tint">
          <KindIcon className="size-3" />
          {tr(PERSONA_KIND_LABEL_KEYS[persona.kind])}
        </Badge>
      ),
    },
    ...(persona.role
      ? [{ label: tr("requirements.persona.field.role"), value: persona.role }]
      : []),
    ...(persona.alephaRole
      ? [
          {
            label: tr("requirements.persona.field.alephaRole"),
            value: (
              <code className="font-mono text-xs">{persona.alephaRole}</code>
            ),
          },
        ]
      : []),
    ...(persona.demoAccount
      ? [
          {
            label: tr("requirements.persona.field.demoAccount"),
            copy: persona.demoAccount,
          },
        ]
      : []),
    ...(persona.demoSeed
      ? [
          {
            label: tr("requirements.persona.field.demoSeed"),
            copy: persona.demoSeed,
          },
        ]
      : []),
    ...(persona.environmentApp
      ? [
          {
            label: tr("requirements.persona.aside.environment"),
            value: `${persona.environmentApp}${persona.environmentEnv ? ` · ${persona.environmentEnv}` : ""}`,
          },
        ]
      : []),
    ...(persona.areas.length
      ? [
          {
            label: tr("requirements.persona.aside.areas"),
            value: persona.areas.join(", "),
          },
        ]
      : []),
    {
      label: tr("requirements.persona.aside.created"),
      value: i18n.l(persona.createdAt, { date: "ll" }),
    },
  ];

  return <DetailAside rows={rows} />;
};

export default PersonaAside;
