import * as React from "react";

void React;

import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import { cn } from "@alepha/ui/lib/utils";
import type { AdminParameterController } from "alepha/api/parameters";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Archive,
  ChevronRight,
  CircleCheck,
  Clock,
  Eye,
  GitCompare,
  MoreVertical,
  RotateCcw,
  Tag,
} from "lucide-react";
import { useState } from "react";
import { ParameterDiffDialog } from "./parameter-diff-dialog.tsx";
import { ParameterJsonDialog } from "./parameter-json-dialog.tsx";

type HistoryVersion = Awaited<
  ReturnType<AdminParameterController["getHistory"]>
>["versions"][number];

export interface ParameterHistoryItemProps {
  version: HistoryVersion;
  onRollback: (version: number) => void | Promise<void>;
}

/**
 * One parameter version, rendered as a flush, square row in the history stack.
 *
 * The whole header row toggles the body (version / created-at / created-by /
 * tags). The `…` menu (View JSON / Diff with previous / Rollback) stops click
 * propagation so using it never toggles the row.
 */
export const ParameterHistoryItem = (props: ParameterHistoryItemProps) => {
  const { l, tr } = useI18n();
  const router = useRouter();
  const v = props.version;
  const [open, setOpen] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const hasPrevious = v.previousContent != null;
  const isCurrent = v.status === "current";
  const toggle = () => setOpen((o) => !o);

  return (
    <div className="border-b">
      <div
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        className="hover:bg-accent/50 flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 transition-colors"
      >
        <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
          {statusIcon(v.status)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 ml-1">
          <span className="text-sm font-semibold capitalize leading-tight">
            {v.status}
          </span>
          <span className="text-muted-foreground flex items-center gap-1 text-xs leading-tight">
            <Clock className="size-3" />
            {String(l(v.activationDate, { date: "fromNow" }))}
          </span>
        </div>

        {/* Actions: intercept clicks so the menu never toggles the row. */}
        <div
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  aria-label={tr("admin.parameters.versionActions", {
                    default: "Version actions",
                  })}
                />
              }
            >
              <MoreVertical className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setJsonOpen(true)}>
                <Eye className="mr-2 size-4" />
                {tr("admin.parameters.view", { default: "View" })}
              </DropdownMenuItem>
              {hasPrevious && (
                <DropdownMenuItem onClick={() => setDiffOpen(true)}>
                  <GitCompare className="mr-2 size-4" />
                  {tr("admin.parameters.diffWithPrevious", {
                    default: "Diff with previous",
                  })}
                </DropdownMenuItem>
              )}
              {!isCurrent && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => props.onRollback(v.version)}>
                    <RotateCcw className="mr-2 size-4" />
                    {tr("admin.parameters.rollback", { default: "Rollback" })}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <span className="text-muted-foreground flex size-4 shrink-0 items-center justify-center">
          <ChevronRight
            className={cn(
              "size-4 transition-transform duration-200",
              open && "rotate-90",
            )}
          />
        </span>
      </div>

      {/* Animated collapse: grid-rows 0fr→1fr smoothly interpolates height
          without measuring. The body stays mounted so the transition runs. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t px-3 py-2.5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">
                {tr("admin.parameters.fieldVersion", { default: "Version" })}
              </dt>
              <dd className="font-mono font-medium">v{v.version}</dd>

              <dt className="text-muted-foreground">
                {tr("admin.parameters.fieldCreatedAt", {
                  default: "Created at",
                })}
              </dt>
              <dd>{String(l(v.createdAt, { date: "lll" }))}</dd>

              <dt className="text-muted-foreground">
                {tr("admin.parameters.fieldCreatedBy", {
                  default: "Created by",
                })}
              </dt>
              <dd className="truncate">
                {v.creatorId ? (
                  <button
                    type="button"
                    className="text-primary truncate hover:underline"
                    onClick={() =>
                      router.push(`/admin/users/${v.creatorId}` as never)
                    }
                  >
                    {v.creator?.username ??
                      v.creator?.email ??
                      v.creatorName ??
                      v.creatorId}
                  </button>
                ) : (
                  (v.creatorName ?? "—")
                )}
              </dd>

              {v.changeDescription && (
                <>
                  <dt className="text-muted-foreground">
                    {tr("admin.parameters.fieldNote", { default: "Note" })}
                  </dt>
                  <dd className="leading-snug">{v.changeDescription}</dd>
                </>
              )}

              {v.tags && v.tags.length > 0 && (
                <>
                  <dt className="text-muted-foreground flex items-center gap-1">
                    <Tag className="size-3" />
                    {tr("admin.parameters.fieldTags", { default: "Tags" })}
                  </dt>
                  <dd className="flex flex-wrap gap-1">
                    {v.tags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </div>

      <ParameterJsonDialog
        open={jsonOpen}
        onOpenChange={setJsonOpen}
        title={`v${v.version} — ${v.name}`}
        content={v.content}
      />
      {hasPrevious && (
        <ParameterDiffDialog
          open={diffOpen}
          onOpenChange={setDiffOpen}
          title={`v${v.version} — ${v.name}`}
          previous={v.previousContent}
          current={v.content}
        />
      )}
    </div>
  );
};

const statusIcon = (status: HistoryVersion["status"]) => {
  if (status === "current") {
    return (
      <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
    );
  }
  if (status === "expired") return <Archive className="size-4" />;
  return <Clock className="size-4" />;
};
