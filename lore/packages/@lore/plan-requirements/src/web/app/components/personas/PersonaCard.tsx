import { Badge, Card, CardContent } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";

import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import {
  PERSONA_KIND_ICONS,
  PERSONA_KIND_LABEL_KEYS,
} from "./personaKindLabels.ts";

export interface PersonaCardProps {
  persona: PersonaResource;
  href: string;
}

/**
 * One persona on the Personas tab (#E153): avatar, reference, name, role,
 * kind, the first line of its goals, and the Alepha role it plays. The use
 * case, epic and requirement counts and the last run arrive with the quests
 * that bring them.
 */
const PersonaCard = (props: PersonaCardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const persona = props.persona;
  const KindIcon = PERSONA_KIND_ICONS[persona.kind];
  const goal = persona.goals
    .split("\n")
    .map((line) => line.replace(/^[-*#>\s]+/, "").trim())
    .find(Boolean);
  const initials = persona.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Link href={props.href} className="block" data-testid="persona-card">
      <Card className="hover:border-foreground/30 h-full transition-colors">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden
              className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            >
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-muted-foreground font-mono text-xs">
                  {formatReference("persona", persona.number)}
                </span>
                <span className="truncate font-semibold">{persona.name}</span>
              </div>
              {persona.role ? (
                <div className="text-muted-foreground truncate text-sm">
                  {persona.role}
                </div>
              ) : null}
            </div>
            <Badge variant="tint">
              <KindIcon className="size-3" />
              {tr(PERSONA_KIND_LABEL_KEYS[persona.kind])}
            </Badge>
          </div>
          {goal ? (
            <blockquote className="text-muted-foreground border-l-2 pl-3 text-sm italic">
              {goal}
            </blockquote>
          ) : null}
          {persona.alephaRole ? (
            <div className="text-xs">
              <span className="text-muted-foreground">
                {tr("requirements.persona.field.alephaRole")}:{" "}
              </span>
              <code className="font-mono">{persona.alephaRole}</code>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
};

export default PersonaCard;
