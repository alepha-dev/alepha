import { MarkdownView } from "@alepha/ui/markdown";
import {
  currentProjectAtom,
  type I18n,
  userProjectsAtom,
} from "@lore/core/web";
import type { FolioController } from "@lore/remember/api";
import { useClient, useQuery, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import { AssistantLineDiff } from "./AssistantLineDiff.ts";

export interface AssistantFolioChangeProps {
  /**
   * The paused call's id: each card reads the folio afresh, so a second
   * update of the same folio never diffs against what the first replaced.
   */
  callId: string;
  /**
   * The project the folio is resolved in: the call's own, or the room's.
   */
  projectId?: number;
  /**
   * The folio's global id, when the call names it so.
   */
  id?: string;
  /**
   * The folio's per-project number, when the call names it so.
   */
  shortId?: number;
  /**
   * The content the update writes, when it writes one.
   */
  content?: string;
}

/**
 * What a `folio_update` changes (#Q4547): the folio it targets, read as the
 * member, and its content before and after as a line diff, since an update
 * replaces the whole body. The new content is rendered below the diff as
 * Lore renders it.
 *
 * The card says what the member must know before approving: that the folio
 * lives in another project than the one on screen (the tool resolves an `id`
 * whatever project the call names), that the server will refuse the content
 * (a protected folio, a table or a calendar), or that no diff could be drawn
 * (the folio could not be read, or is too long to compare). The call still
 * runs only once the member approves it, and its gate decides.
 */
const AssistantFolioChange = (props: AssistantFolioChangeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const folioApi = useClient<FolioController>();
  const [project] = useStore(currentProjectAtom);
  const [overview] = useStore(userProjectsAtom);
  const { callId, projectId, id, shortId, content } = props;
  const resolvable =
    id !== undefined || (shortId !== undefined && projectId !== undefined);

  const query = useQuery(
    {
      key: ["assistant-folio-before", callId],
      enabled: resolvable,
      handler: async () => {
        const folio =
          id !== undefined
            ? await folioApi.get({ params: { id } })
            : await folioApi.getByShortId({
                params: { projectId: projectId!, shortId: shortId! },
              });
        return {
          projectId: folio.projectId,
          shortId: folio.shortId,
          title: folio.title,
          type: folio.type,
          protected: folio.protected === true,
          content: folio.content ?? "",
        };
      },
      onError: () => {},
    },
    [folioApi, callId, projectId, id, shortId],
  );
  const before = query.data;
  const reading = resolvable && query.loading && !before;
  const refused =
    before && content !== undefined
      ? before.protected
        ? "protected"
        : before.type !== "text"
          ? "table"
          : undefined
      : undefined;
  const lines = useMemo(
    () =>
      before && !refused && content !== undefined
        ? (AssistantLineDiff.diff(before.content, content) ?? "too-long")
        : undefined,
    [before, refused, content],
  );
  const elsewhere =
    before !== undefined &&
    project !== undefined &&
    before.projectId !== project.id;
  const elsewhereTitle = elsewhere
    ? (overview?.projects.find((it) => it.id === before.projectId)?.title ??
      String(before.projectId))
    : undefined;

  return (
    <>
      <div data-testid="assistant-confirm-folio">
        <span className="text-muted-foreground">
          {tr("assistant.confirm.folio")}
        </span>{" "}
        <span className="font-medium">
          {before
            ? `#F${before.shortId} ${before.title}`
            : id !== undefined
              ? id
              : shortId !== undefined
                ? `#F${shortId}`
                : ""}
        </span>
        {elsewhere && (
          <span
            className="text-destructive ml-1"
            data-testid="assistant-confirm-folio-elsewhere"
          >
            {tr("assistant.confirm.folio.elsewhere", {
              args: [elsewhereTitle ?? ""],
            })}
          </span>
        )}
      </div>
      {refused && (
        <p
          className="text-destructive text-xs"
          data-testid="assistant-confirm-folio-refused"
        >
          {tr(
            refused === "protected"
              ? "assistant.confirm.folio.protected"
              : "assistant.confirm.folio.table",
          )}
        </p>
      )}
      {content !== undefined && (
        <div data-testid="assistant-confirm-field-content">
          <div className="text-muted-foreground text-xs">
            {tr("assistant.confirm.folio.changes")}
          </div>
          {reading ? (
            <p className="text-muted-foreground text-xs">
              {tr("assistant.confirm.folio.reading")}
            </p>
          ) : lines === "too-long" ? (
            <p
              className="text-muted-foreground text-xs"
              data-testid="assistant-confirm-folio-nodiff"
            >
              {tr("assistant.confirm.folio.tooLong")}
            </p>
          ) : !before && !refused ? (
            <p
              className="text-muted-foreground text-xs"
              data-testid="assistant-confirm-folio-nodiff"
            >
              {tr("assistant.confirm.folio.unread")}
            </p>
          ) : lines && lines.length === 0 ? (
            <p
              className="text-muted-foreground text-xs"
              data-testid="assistant-confirm-folio-same"
            >
              {tr("assistant.confirm.folio.same")}
            </p>
          ) : lines ? (
            <div
              className="overflow-x-auto rounded border font-mono text-xs whitespace-pre"
              data-testid="assistant-confirm-folio-diff"
            >
              {lines.map((line, index) => (
                <div
                  key={`${index}-${line.kind}`}
                  data-kind={line.kind}
                  className={
                    line.kind === "add"
                      ? "bg-green-500/10 text-green-700 dark:text-green-400"
                      : line.kind === "del"
                        ? "bg-red-500/10 text-red-700 dark:text-red-400"
                        : line.kind === "gap"
                          ? "text-muted-foreground bg-muted/50 italic"
                          : "text-muted-foreground"
                  }
                >
                  {line.kind === "gap"
                    ? tr("assistant.confirm.folio.gap", { args: [line.text] })
                    : `${line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "} ${line.text}`}
                </div>
              ))}
            </div>
          ) : null}
          {!(lines && lines !== "too-long" && lines.length === 0) && (
            <div className="mt-2" data-testid="assistant-confirm-folio-after">
              <div className="text-muted-foreground text-xs">
                {tr("assistant.confirm.folio.after")}
              </div>
              <MarkdownView content={content} />
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default AssistantFolioChange;
