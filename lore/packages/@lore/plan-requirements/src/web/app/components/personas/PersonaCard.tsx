import { Badge, Card, CardContent } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { DateTimeProvider } from "alepha/datetime";
import { ClientOnly, useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { ShieldUser } from "lucide-react";

import type { PersonaResource } from "../../../../api/schemas/personaResourceSchema.ts";
import VerifyMenu from "../verify/VerifyMenu.tsx";
import { alephaRoleLabel } from "./alephaRoleLabel.ts";
import PersonaAvatar from "./PersonaAvatar.tsx";
import type { PersonaCoverage } from "./personaCoverage.ts";
import {
  PERSONA_KIND_ICONS,
  PERSONA_KIND_LABEL_KEYS,
  PERSONA_KIND_TONES,
} from "./personaKindLabels.ts";
import PersonaOpenAsButton from "./PersonaOpenAsButton.tsx";
import PersonaRunBar from "./PersonaRunBar.tsx";

export interface PersonaCardProps {
  persona: PersonaResource;
  href: string;
  /**
   * Absent while the use cases load: the counts and the run bar wait.
   */
  coverage?: PersonaCoverage;
}

/**
 * One persona on the Personas page (#E153): avatar, reference, name, role,
 * kind, the first line of its goals and the Alepha role it plays, then the
 * use cases, epics and requirements it reaches, how their last runs went,
 * and Open as and Verify.
 *
 * The whole card opens the persona's page through its name's link, stretched
 * over the card, rather than by wrapping the card in a link: the footer's
 * buttons sit above it, and a button inside a link is not valid HTML.
 */
const PersonaCard = (props: PersonaCardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dateTime = useInject(DateTimeProvider);
  const persona = props.persona;
  const coverage = props.coverage;
  const KindIcon = PERSONA_KIND_ICONS[persona.kind];
  const goal = persona.goals
    .split("\n")
    .map((line) => line.replace(/^[-*#>\s]+/, "").trim())
    .find(Boolean);

  // A role identifier reads as a badge under the kind, a sentence as plain
  // text under the goal (#Q3960).
  const alephaRole = persona.alephaRole
    ? alephaRoleLabel(persona.alephaRole)
    : undefined;

  const total = coverage?.useCases ?? 0;
  const tone = !coverage?.lastRanAt
    ? "text-muted-foreground"
    : coverage.failed > 0
      ? "text-orange-600 dark:text-orange-400"
      : coverage.passed === total
        ? "text-green-600 dark:text-green-500"
        : "text-muted-foreground";

  return (
    <Card
      data-testid="persona-card"
      variant="raised"
      interactive
      className="relative h-full"
    >
      <CardContent className="flex h-full flex-col gap-3">
        <div className="flex items-start gap-3">
          <PersonaAvatar name={persona.name} className="size-10" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground font-mono text-xs">
                {formatReference("persona", persona.number)}
              </span>
              <Link
                href={props.href}
                className="truncate font-semibold after:absolute after:inset-0 after:content-['']"
              >
                {persona.name}
              </Link>
            </div>
            {persona.role ? (
              <div className="text-muted-foreground truncate text-xs">
                {persona.role}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge variant="tint" tone={PERSONA_KIND_TONES[persona.kind]}>
              <KindIcon className="size-3" />
              {tr(PERSONA_KIND_LABEL_KEYS[persona.kind])}
            </Badge>
            {alephaRole?.kind === "badge" ? (
              <Badge
                variant="outline"
                title={persona.alephaRole}
                data-testid="persona-alepha-role"
              >
                <ShieldUser className="size-3" />
                {alephaRole.label}
              </Badge>
            ) : null}
          </div>
        </div>
        {goal ? (
          <blockquote className="text-muted-foreground border-l-2 pl-3 text-sm italic">
            {goal}
          </blockquote>
        ) : null}
        {alephaRole?.kind === "text" ? (
          <p
            className="text-muted-foreground flex items-start gap-1.5 text-xs break-words"
            data-testid="persona-alepha-role"
          >
            <ShieldUser className="mt-0.5 size-3 shrink-0" />
            <span>
              {tr("requirements.persona.card.role", {
                args: [alephaRole.text],
              })}
            </span>
          </p>
        ) : null}
        <div className="mt-auto grid grid-cols-3 gap-2">
          {(
            [
              ["useCases", "requirements.persona.card.useCases"],
              ["epics", "requirements.persona.card.epics"],
              ["requirements", "requirements.persona.card.requirements"],
            ] as const
          ).map(([key, labelKey]) => (
            <div key={key}>
              <div className="text-lg font-semibold tabular-nums">
                {coverage ? coverage[key] : "-"}
              </div>
              <div className="text-muted-foreground text-xs">
                {tr(labelKey)}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {tr("requirements.persona.card.lastRun")}
            </span>
            {coverage ? (
              <span className={`font-medium ${tone}`}>
                {coverage.lastRanAt ? (
                  <>
                    {tr("requirements.persona.card.passed", {
                      args: [String(coverage.passed), String(total)],
                    })}
                    {" · "}
                    {coverage.failed > 0 ? (
                      tr("requirements.persona.card.failed", {
                        args: [String(coverage.failed)],
                      })
                    ) : (
                      // `fromNow()` reads the clock: rendered on the client
                      // only, or the server's answer and the browser's differ.
                      <ClientOnly>
                        {dateTime.of(coverage.lastRanAt).fromNow()}
                      </ClientOnly>
                    )}
                  </>
                ) : (
                  tr("requirements.persona.card.neverRun")
                )}
              </span>
            ) : null}
          </div>
          <PersonaRunBar coverage={coverage} />
        </div>
        {/* Above the name's stretched link, so a click here is the button's. */}
        <div className="relative z-10 flex gap-2 border-t pt-3">
          <PersonaOpenAsButton persona={persona} className="flex-1" />
          <VerifyMenu
            variant="button"
            className="flex-1"
            subject={{ kind: "persona", number: persona.number }}
          />
        </div>
      </CardContent>
    </Card>
  );
};

export default PersonaCard;
