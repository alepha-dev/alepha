import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { PersonaChange } from "../../../../api/schemas/personaInsightSchemas.ts";
import ReferenceLink from "../shared/ReferenceLink.tsx";

export interface PersonaChangeRowProps {
  change: PersonaChange;
  /**
   * The persona's number, named when the quest only mentions it.
   */
  persona: number;
}

/**
 * One completed quest touching a persona (#E153), and how it reaches it:
 * through an epic covering one of its use cases, or by naming it.
 */
const PersonaChangeRow = (props: PersonaChangeRowProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { change } = props;
  return (
    <li className="flex justify-between gap-2" data-testid="persona-change">
      <ReferenceLink kind="quest" number={change.questNumber}>
        {change.title}
      </ReferenceLink>
      <span className="text-muted-foreground shrink-0 text-xs">
        {change.via === "epic" && change.epicNumber
          ? tr("requirements.persona.changes.viaEpic", {
              args: [formatReference("epic", change.epicNumber)],
            })
          : tr("requirements.persona.changes.viaMention", {
              args: [formatReference("persona", props.persona)],
            })}
      </span>
    </li>
  );
};

export default PersonaChangeRow;
