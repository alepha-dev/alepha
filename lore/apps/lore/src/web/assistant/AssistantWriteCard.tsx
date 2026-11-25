import {
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@alepha/ui";
import type { AiChatConfirmCardProps } from "@alepha/ui/ai";
import { MarkdownView } from "@alepha/ui/markdown";
import {
  currentProjectAtom,
  type I18n,
  userProjectsAtom,
} from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

export interface AssistantWriteCardProps extends AiChatConfirmCardProps {
  /**
   * The write tool the card asks about, which names its title.
   */
  tool: AssistantWriteTool;
}

/**
 * A write tool of the assistant (#Q3210).
 */
export type AssistantWriteTool =
  | "quest_create"
  | "quest_comment_add"
  | "quest_update"
  | "quest_complete"
  | "folio_create"
  | "feedback_submit";

/**
 * Asks the member before the assistant writes (#Q3210). The card IS the
 * confirmation: the prompt tells the model never to ask in text.
 *
 * It shows what an approval runs, the input the SERVER stored: the project
 * first, then every field the call sets, prose fields (a description, a
 * comment, a folio) rendered as Lore renders them, through `MarkdownView`.
 * Nothing is hidden, so `quest_update`, offered whole, shows each field it
 * would change.
 */
const AssistantWriteCard = (props: AssistantWriteCardProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [project] = useStore(currentProjectAtom);
  const [overview] = useStore(userProjectsAtom);
  const input = props.pending.input;
  const projectId = input.project;
  // Another project is named by its title too, from the member's own list:
  // a feedback filed elsewhere (#Q3971) must say plainly where it goes.
  const projectLabel =
    project && projectId !== undefined && projectId === project.id
      ? project.title
      : (overview?.projects.find((it) => it.id === projectId)?.title ??
        String(input.project_name ?? projectId ?? ""));
  const elsewhere =
    projectId !== undefined &&
    project !== undefined &&
    projectId !== project.id;

  const fields = Object.entries(input).filter(
    ([key, value]) =>
      !AssistantWriteCard.hidden.has(key) &&
      value !== undefined &&
      value !== null &&
      value !== "",
  );

  return (
    <Card data-testid="assistant-confirm" className="gap-2">
      <CardHeader>
        <CardTitle className="text-sm">
          {tr(`assistant.confirm.${props.tool}`)}
        </CardTitle>
      </CardHeader>
      {/* Capped and scrolling on its own (#Q4303): a long quest drawn at
          full height filled the room and pushed the conversation away. The
          footer sits outside it, so Approve and Deny never scroll away. */}
      <CardContent
        className="flex max-h-80 flex-col gap-2 overflow-y-auto text-sm"
        data-testid="assistant-confirm-body"
      >
        <div data-testid="assistant-confirm-project">
          <span className="text-muted-foreground">
            {tr("assistant.confirm.project")}
          </span>{" "}
          <span className="font-medium">{projectLabel}</span>
          {elsewhere && (
            <span className="text-destructive ml-1">
              {tr("assistant.confirm.elsewhere")}
            </span>
          )}
        </div>
        {fields.map(([key, value]) => (
          <div key={key} data-testid={`assistant-confirm-field-${key}`}>
            <div className="text-muted-foreground text-xs">{key}</div>
            {AssistantWriteCard.prose.has(key) && typeof value === "string" ? (
              <MarkdownView content={value} />
            ) : (
              <div className="break-words whitespace-pre-wrap">
                {AssistantWriteCard.show(value)}
              </div>
            )}
          </div>
        ))}
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          intent="primary"
          disabled={props.loading}
          onClick={() => props.onApprove()}
        >
          {tr("ai.chat.approve", { default: "Approve" })}
        </Button>
        <Button
          variant="outlined"
          disabled={props.loading}
          onClick={() => props.onDeny()}
        >
          {tr("ai.chat.deny", { default: "Deny" })}
        </Button>
      </CardFooter>
    </Card>
  );
};

/**
 * Shown above the fields, or provenance the model is told to pass: not
 * something the member decides.
 */
AssistantWriteCard.hidden = new Set(["project", "project_name", "as"]);

/**
 * Fields Lore stores as markdown.
 */
AssistantWriteCard.prose = new Set([
  "description",
  "body",
  "message",
  "content",
]);

/**
 * A field's value as text: a list one item per line, an object as JSON.
 */
AssistantWriteCard.show = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        item && typeof item === "object" && "title" in item
          ? String((item as { title: unknown }).title)
          : typeof item === "object"
            ? JSON.stringify(item)
            : String(item),
      )
      .join("\n");
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
};

export default AssistantWriteCard;
