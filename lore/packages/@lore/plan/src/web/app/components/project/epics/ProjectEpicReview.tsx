import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  useDialog,
  cn,
  textLinkUnderlineClassName,
} from "@alepha/ui";
import { currentProjectAtom, formatReference, type I18n } from "@lore/core/web";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { useLayoutEffect, useRef, useState } from "react";

import type { EpicReviewAnswer } from "../../../../../api/schemas/epicReviewAnswerSchema.ts";
import type { EpicReviewItemResource } from "../../../../../api/schemas/epicReviewItemResourceSchema.ts";
import type { EpicReviewsResult } from "../../../../../api/schemas/epicReviewsResultSchema.ts";
import EpicAgentJobLink from "./EpicAgentJobLink.tsx";
import EpicReviewQuestion from "./EpicReviewQuestion.tsx";

export interface ProjectEpicReviewProps {
  epicId: number;
  /**
   * `null` while the reviews load or when the read failed: the tab shows no
   * empty state then, which would read as "never reviewed".
   */
  reviews: EpicReviewsResult | null;
  writable: boolean;
  /**
   * The item whose answer is in flight, and the answer (#Q4510): only that
   * item shows it; the rest of the tab stays as it is.
   */
  answering?: { number: number; answer: EpicReviewAnswer };
  onAnswer: (number: number, answer: EpicReviewAnswer) => void;
}

/**
 * The epic page's Review tab (#E121, folio #F1460): what every run of
 * "Review epic" filed, as the owner answers it.
 *
 * - **Open questions first**, numbered as stored, each answerable in place
 *   (`EpicReviewQuestion`).
 * - **The decision log**: answered questions and the decisions that stand,
 *   newest first. A decision can be overturned, which files the new one.
 * - **The reviews**: each with its author, date and summary, and the
 *   changes it made, linked to the quest or epic they touched.
 *
 * Writable only while the epic is `draft` or `ready`; past that the record
 * is read-only and the server refuses anyway.
 *
 * Answering keeps the tab still (#Q4510): only the item answered shows it is
 * busy, and once answered it collapses out of the open list, kept drawn for
 * the length of the transition (none under reduced motion).
 */
const ProjectEpicReview = (props: ProjectEpicReviewProps) => {
  const { tr, l } = useI18n<I18n, "en">();
  const dialog = useDialog();
  const router = useRouter();
  const [project] = useStore(currentProjectAtom);

  const items = (props.reviews?.reviews ?? [])
    .flatMap((review) => review.items)
    .sort((a, b) => a.number - b.number);
  // Blockers first (#Q3634), then questions, each by number.
  const byKind = (a: EpicReviewItemResource, b: EpicReviewItemResource) =>
    Number(b.kind === "blocker") - Number(a.kind === "blocker") ||
    a.number - b.number;
  const open = items.filter((item) => item.state === "open").sort(byKind);
  const leaving = useLeavingItems(open);

  if (!props.reviews) return null;
  const openBlockers = open.filter((item) => item.kind === "blocker").length;
  const log = items
    .filter((item) =>
      item.kind === "question" || item.kind === "blocker"
        ? item.state === "answered"
        : item.kind === "decision" && item.replacedBy == null,
    )
    .toReversed();

  const overturn = async (item: EpicReviewItemResource) => {
    const answer = await dialog.prompt({
      title: tr("epic.review.overturn.title", { args: [String(item.number)] }),
      description: item.title,
      label: tr("epic.review.overturn.label"),
      confirmLabel: tr("epic.review.overturn"),
      cancelLabel: tr("common.cancel"),
      validate: (value) =>
        value.trim() ? null : tr("epic.review.answer.required"),
    });
    if (answer?.trim()) props.onAnswer(item.number, { answer: answer.trim() });
  };

  const targetLink = (item: EpicReviewItemResource) => {
    if (!item.target || !project) return null;
    const href =
      item.target.kind === "quest"
        ? router.path("projectQuest", {
            params: {
              projectSlug: project.slug,
              shortId: String(item.target.number),
            },
          })
        : router.path("projectEpic", {
            params: {
              projectSlug: project.slug,
              epicNumber: String(item.target.number),
            },
          });
    return (
      <Link
        href={href}
        className={cn(
          textLinkUnderlineClassName,
          "hover:text-foreground ml-2 text-xs",
        )}
      >
        {formatReference(item.target.kind, item.target.number)}
      </Link>
    );
  };

  if (props.reviews.reviews.length === 0) {
    return (
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-4">
        <EpicAgentJobLink jobId={props.reviews.agentJobId} />
        <p className="text-muted-foreground text-sm italic">
          {tr("epic.review.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <EpicAgentJobLink jobId={props.reviews.agentJobId} />
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">
          {openBlockers > 0
            ? tr("epic.review.openWithBlockers", {
                args: [
                  String(openBlockers),
                  String(open.length - openBlockers),
                ],
              })
            : tr("epic.review.open", { args: [String(open.length)] })}
        </h3>
        {open.length === 0 && leaving.items.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">
            {tr("epic.review.open.none")}
          </p>
        ) : (
          [...open, ...leaving.items].sort(byKind).map((item) => {
            const gone = leaving.has(item.id);
            return (
              // Collapses its height through grid rows, without measuring.
              <div
                key={item.id}
                data-leaving={gone || undefined}
                className={cn(
                  "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
                  gone && leaving.collapsed
                    ? "grid-rows-[0fr] opacity-0"
                    : "grid-rows-[1fr] opacity-100",
                )}
              >
                {/* Clipped only while it collapses: a card's ring would be
                    cut otherwise. */}
                <div className={cn("min-h-0", gone && "overflow-hidden")}>
                  <EpicReviewQuestion
                    epicId={props.epicId}
                    item={item}
                    writable={props.writable && !gone}
                    answering={
                      props.answering?.number === item.number
                        ? props.answering.answer
                        : undefined
                    }
                    onAnswer={props.onAnswer}
                  />
                </div>
              </div>
            );
          })
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{tr("epic.review.log")}</CardTitle>
        </CardHeader>
        <CardContent>
          {log.length === 0 ? (
            <p className="text-muted-foreground text-sm italic">
              {tr("epic.review.log.empty")}
            </p>
          ) : (
            <ul className="divide-y">
              {log.map((item) => (
                <li
                  key={item.id}
                  data-testid={`epic-review-log-${item.number}`}
                  className="flex items-start justify-between gap-3 py-2"
                >
                  <div className="min-w-0 text-sm">
                    <Badge variant="secondary" className="mr-2 font-mono">
                      {item.number}
                    </Badge>
                    <span className="text-muted-foreground mr-2 text-xs">
                      {item.kind === "blocker"
                        ? tr("epic.review.kind.blocker")
                        : item.kind === "question"
                          ? tr("epic.review.kind.question")
                          : tr("epic.review.kind.decision")}
                    </span>
                    {item.title}
                    {(item.kind === "question" || item.kind === "blocker") &&
                      item.answer && (
                        <p className="mt-1">
                          <span className="text-muted-foreground">
                            {tr("epic.review.answered")}
                          </span>{" "}
                          {item.answer}
                        </p>
                      )}
                    {item.replaces != null && (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {tr("epic.review.replaces", {
                          args: [String(item.replaces)],
                        })}
                      </p>
                    )}
                  </div>
                  {item.kind === "decision" && props.writable && (
                    <Button
                      size="sm"
                      variant="minimal"
                      disabled={props.answering?.number === item.number}
                      loading={props.answering?.number === item.number}
                      onClick={() => void overturn(item)}
                    >
                      {tr("epic.review.overturn")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tr("epic.review.timeline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {props.reviews.reviews.map((review) => {
              const changes = review.items.filter(
                (item) => item.kind === "change",
              );
              return (
                <li key={review.id} className="text-sm">
                  <p className="text-muted-foreground text-xs">
                    {tr("epic.review.filed", {
                      args: [
                        l(review.createdAt, { date: "lll" }),
                        String(review.items.length),
                      ],
                    })}
                  </p>
                  {review.summary && <p className="mt-1">{review.summary}</p>}
                  {changes.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">
                      {changes.map((change) => (
                        <li key={change.id}>
                          {change.title}
                          {targetLink(change)}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

/**
 * The open items that just left the open list (#Q4510), kept for the
 * length of their collapse: drawn expanded once, collapsed on the next
 * frame, then dropped.
 */
const useLeavingItems = (open: EpicReviewItemResource[]) => {
  const previous = useRef<EpicReviewItemResource[]>(open);
  const [items, setItems] = useState<EpicReviewItemResource[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  // The collapse's timers live apart from the effect: a list that changes
  // again before they fire (a refetch, an overturn) must not cancel them
  // and leave an item collapsed for good. Replaced by the next item that
  // leaves, cleared on unmount.
  const timers = useRef<{
    frame?: number;
    done?: ReturnType<typeof setTimeout>;
  }>({});
  const ids = open.map((item) => item.id).join(",");
  // Before paint: the item never blinks out before it collapses.
  useLayoutEffect(() => {
    const now = new Set(open.map((item) => item.id));
    const left = previous.current.filter((item) => !now.has(item.id));
    previous.current = open;
    if (left.length === 0) return;
    if (timers.current.frame !== undefined) {
      cancelAnimationFrame(timers.current.frame);
    }
    clearTimeout(timers.current.done);
    setItems(left);
    setCollapsed(false);
    timers.current = {
      frame: requestAnimationFrame(() => setCollapsed(true)),
      done: setTimeout(() => setItems([]), 220),
    };
  }, [ids]);
  useLayoutEffect(
    () => () => {
      if (timers.current.frame !== undefined) {
        cancelAnimationFrame(timers.current.frame);
      }
      clearTimeout(timers.current.done);
    },
    [],
  );
  const leavingIds = new Set(items.map((item) => item.id));
  return {
    items: items.filter((item) => !open.some((it) => it.id === item.id)),
    collapsed,
    has: (id: EpicReviewItemResource["id"]) => leavingIds.has(id),
  };
};

export default ProjectEpicReview;
