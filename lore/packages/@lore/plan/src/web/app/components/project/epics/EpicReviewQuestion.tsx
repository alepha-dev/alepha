import { Badge, Button, Card, CardContent, useDialog } from "@alepha/ui";
import { currentProjectAtom, type I18n, LoreViewer } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import type { EpicReviewAnswer } from "../../../../../api/schemas/epicReviewAnswerSchema.ts";
import type { EpicReviewItemResource } from "../../../../../api/schemas/epicReviewItemResourceSchema.ts";

export interface EpicReviewQuestionProps {
  epicId: number;
  item: EpicReviewItemResource;
  /**
   * Whether the reader may answer: `epic:write`, and the epic still `draft`
   * or `ready`.
   */
  writable: boolean;
  busy: boolean;
  onAnswer: (number: number, answer: EpicReviewAnswer) => void;
}

/**
 * One open review question (#E121), answerable in place: its number as
 * stored, the question, its context, each suggestion with its cost and the
 * reviewer's pick marked. Pick a suggestion, write an answer, or waive.
 *
 * The write itself is the page's `useAction` (`onAnswer`), so every control
 * of every question waits while one answer is in flight.
 */
const EpicReviewQuestion = (props: EpicReviewQuestionProps) => {
  const { tr } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const [project] = useStore(currentProjectAtom);
  const { item } = props;
  const disabled = props.busy || !props.writable;

  const write = async () => {
    const answer = await dialog.prompt({
      title: tr("epic.review.answer.title", { args: [String(item.number)] }),
      description: item.title,
      label: tr("epic.review.answer.label"),
      confirmLabel: tr("epic.review.answer.submit"),
      cancelLabel: tr("common.cancel"),
      validate: (value) =>
        value.trim() ? null : tr("epic.review.answer.required"),
    });
    if (answer?.trim()) props.onAnswer(item.number, { answer: answer.trim() });
  };

  return (
    <Card data-testid={`epic-review-question-${item.number}`}>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <Badge variant="secondary" className="font-mono tabular-nums">
            {item.number}
          </Badge>
          <p className="font-medium">{item.title}</p>
        </div>
        {item.context && (
          <div className="text-muted-foreground text-sm">
            <LoreViewer
              element={{
                kind: "epic",
                projectId: project?.id ?? 0,
                projectSlug: project?.slug ?? "",
                id: props.epicId,
              }}
              content={item.context}
            />
          </div>
        )}
        {item.suggestions.length > 0 && (
          <ul className="space-y-2">
            {item.suggestions.map((suggestion, index) => (
              <li
                key={index}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0 text-sm">
                  <span className="text-muted-foreground mr-2 font-mono">
                    {String.fromCharCode(65 + index)}
                  </span>
                  {suggestion.label}
                  {suggestion.cost && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({suggestion.cost})
                    </span>
                  )}
                  {item.recommended === index && (
                    <Badge variant="outline" className="ml-2">
                      {tr("epic.review.recommended")}
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={item.recommended === index ? "solid" : "outlined"}
                  intent={item.recommended === index ? "primary" : "none"}
                  disabled={disabled}
                  onClick={() =>
                    props.onAnswer(item.number, { suggestion: index })
                  }
                >
                  {tr("epic.review.pick")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {props.writable && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outlined"
              disabled={disabled}
              onClick={() => void write()}
            >
              {tr("epic.review.write")}
            </Button>
            <Button
              size="sm"
              variant="minimal"
              disabled={disabled}
              onClick={() => props.onAnswer(item.number, { waive: true })}
            >
              {tr("epic.review.waive")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EpicReviewQuestion;
