import { Card, CardContent } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type {
  PersonaChange,
  PersonaChanges as Changes,
} from "../../../../api/schemas/personaInsightSchemas.ts";

export interface PersonaChangesProps {
  name: string;
  number: number;
  changes: Changes;
}

const ChangeRow = (props: { change: PersonaChange; persona: number }) => {
  const { tr } = useI18n<I18n, "en">();
  const { change } = props;
  return (
    <li className="flex justify-between gap-2" data-testid="persona-change">
      <span>
        <span className="font-semibold">
          {formatReference("quest", change.questNumber)}
        </span>{" "}
        {change.title}
      </span>
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

/**
 * A persona's Changes tab (#E153): the completed quests that touch it
 * since its last run, and "What's new" per release.
 */
const PersonaChanges = (props: PersonaChangesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { changes } = props;
  return (
    <div className="flex flex-col gap-4" data-testid="persona-changes">
      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <h2 className="font-semibold">
            {tr("requirements.persona.changes.title")}
          </h2>
          {!changes.lastRunAt ? (
            <p className="text-muted-foreground">
              {tr("requirements.persona.changes.neverRun")}
            </p>
          ) : changes.changes.length === 0 ? (
            <p className="text-muted-foreground">
              {tr("requirements.persona.changes.none")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {changes.changes.map((it) => (
                <ChangeRow
                  key={it.questNumber}
                  change={it}
                  persona={props.number}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {changes.releases.length ? (
        <Card>
          <CardContent className="flex flex-col gap-3 text-sm">
            <h2 className="font-semibold">
              {tr("requirements.persona.whatsNew", { args: [props.name] })}
            </h2>
            {changes.releases.map((group) => (
              <section
                key={group.release?.id ?? "none"}
                className="flex flex-col gap-1"
                data-testid="persona-whats-new"
              >
                <h3 className="text-xs font-semibold">
                  {group.release
                    ? (group.release.tag ?? group.release.title)
                    : tr("requirements.persona.release.none")}
                </h3>
                <ul className="flex flex-col gap-1">
                  {group.quests.map((it) => (
                    <ChangeRow
                      key={it.questNumber}
                      change={it}
                      persona={props.number}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
};

export default PersonaChanges;
