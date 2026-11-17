import { Badge, Card, CardContent } from "@alepha/ui";
import { formatReference, type I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { PersonaShowcase as Showcase } from "../../../../api/schemas/personaInsightSchemas.ts";

export interface PersonaShowcaseProps {
  showcase: Showcase;
}

/**
 * A persona's Showcase tab (#E153): per release, the latest recording of
 * each of its use cases, read from the run evidence. A recording retention
 * removed keeps its row and says so; the use case's steps are its
 * chapters.
 */
const PersonaShowcase = (props: PersonaShowcaseProps) => {
  const i18n = useI18n<I18n, "en">();
  const { tr } = i18n;
  return (
    <div className="flex flex-col gap-6" data-testid="persona-showcase">
      {props.showcase.map((group) => (
        <section
          key={group.release?.id ?? "current"}
          className="flex flex-col gap-3"
        >
          <h2 className="text-sm font-semibold">
            {group.release
              ? (group.release.tag ?? group.release.title)
              : tr("requirements.persona.showcase.current")}
          </h2>
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(20rem, 1fr))",
            }}
          >
            {group.items.map((item) => (
              <Card key={item.runId} data-testid="showcase-item">
                <CardContent className="flex flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <span className="font-semibold">
                        {formatReference("usecase", item.useCase.number)}
                      </span>{" "}
                      {item.useCase.title}
                    </span>
                    {item.stale ? (
                      <Badge variant="tint" tone="warning">
                        {tr("requirements.persona.showcase.stale")}
                      </Badge>
                    ) : null}
                  </div>
                  {item.file ? (
                    // oxlint-disable-next-line jsx-a11y/media-has-caption
                    <video
                      controls
                      preload="metadata"
                      className="w-full rounded-md border"
                      src={`/api/files/${item.file.fileId}`}
                    />
                  ) : (
                    <p className="text-muted-foreground rounded-md border p-6 text-center text-xs">
                      {tr("requirements.persona.showcase.removed")}
                    </p>
                  )}
                  <p className="text-muted-foreground text-xs">
                    {i18n.l(item.ranAt, { date: "lll" })}
                  </p>
                  {item.chapters.length ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer font-medium">
                        {tr("requirements.persona.showcase.chapters")}
                      </summary>
                      <ol className="mt-1 list-decimal pl-4">
                        {item.chapters.map((it) => (
                          <li key={it.position}>{it.text}</li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
};

export default PersonaShowcase;
