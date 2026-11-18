import {
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { CirclePlay, GitCommitHorizontal } from "lucide-react";

import type { PersonaChanges as Changes } from "../../../../api/schemas/personaInsightSchemas.ts";
import PersonaChangeRow from "./PersonaChangeRow.tsx";

export interface PersonaChangesProps {
  name: string;
  number: number;
  changes: Changes;
}

/**
 * A persona's Changes tab (#E153): the completed quests that touch it
 * since its last run, and "What's new" per release.
 */
const PersonaChanges = (props: PersonaChangesProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { changes } = props;
  // No run yet to count from, or nothing completed since the last one.
  const compact = changes.releases.length > 0;
  const empty = (
    <Empty
      className={compact ? "p-4" : undefined}
      data-testid="persona-changes-empty"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {changes.lastRunAt ? <GitCommitHorizontal /> : <CirclePlay />}
        </EmptyMedia>
        <EmptyTitle>
          {tr(
            changes.lastRunAt
              ? "requirements.persona.changes.none.title"
              : "requirements.persona.changes.neverRun.title",
          )}
        </EmptyTitle>
        <EmptyDescription>
          {tr(
            changes.lastRunAt
              ? "requirements.persona.changes.none.description"
              : "requirements.persona.changes.neverRun.description",
          )}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  return (
    <div className="flex flex-1 flex-col gap-4" data-testid="persona-changes">
      {changes.changes.length === 0 && !changes.releases.length ? (
        // Nothing at all to show: the empty state fills the tab.
        empty
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <h2 className="font-semibold">
              {tr("requirements.persona.changes.title")}
            </h2>
            {changes.changes.length === 0 ? (
              // The "What's new" card follows: the empty state stays inside
              // this card, compact, rather than pushing that list down.
              empty
            ) : (
              <ul className="flex flex-col gap-1">
                {changes.changes.map((it) => (
                  <PersonaChangeRow
                    key={it.questNumber}
                    change={it}
                    persona={props.number}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
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
                    <PersonaChangeRow
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
