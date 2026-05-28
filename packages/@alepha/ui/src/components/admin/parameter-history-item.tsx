import * as React from "react";

void React;

import { CollapsibleCard } from "@alepha/ui/components/collapsible-card/collapsible-card";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui/components/ui/dropdown-menu";
import type { AdminParameterController } from "alepha/api/parameters";
import { useI18n } from "alepha/react/i18n";
import {
  Archive,
  CircleDot,
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
 * One parameter version rendered as a collapsible card.
 *
 * Header: status icon · status badge · relative activation date, with a `…`
 * dropdown (Rollback / View / Diff with previous) left of the caret.
 * Body: version, created-at, created-by, and tags.
 */
export const ParameterHistoryItem = (props: ParameterHistoryItemProps) => {
  const { l, tr } = useI18n();
  const v = props.version;
  const [jsonOpen, setJsonOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const hasPrevious = v.previousContent != null;
  const isCurrent = v.status === "current";

  return (
    <>
      <CollapsibleCard
        className={isCurrent ? "ring-primary/40" : undefined}
        icon={statusIcon(v.status)}
        header={
          <div className="flex items-center gap-2">
            <Badge
              variant={
                v.status === "current"
                  ? "default"
                  : v.status === "next" || v.status === "future"
                    ? "secondary"
                    : "outline"
              }
              className="text-[10px] uppercase"
            >
              {v.status}
            </Badge>
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <Clock className="size-3" />
              {String(l(v.activationDate, { date: "fromNow" }))}
            </span>
          </div>
        }
        actions={
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
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">
            {tr("admin.parameters.fieldVersion", { default: "Version" })}
          </dt>
          <dd className="font-mono font-medium">v{v.version}</dd>

          <dt className="text-muted-foreground">
            {tr("admin.parameters.fieldCreatedAt", { default: "Created at" })}
          </dt>
          <dd>{String(l(v.createdAt, { date: "lll" }))}</dd>

          <dt className="text-muted-foreground">
            {tr("admin.parameters.fieldCreatedBy", { default: "Created by" })}
          </dt>
          <dd className="truncate">{v.creatorName ?? "—"}</dd>

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
                  <Badge key={tag} variant="outline" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </dd>
            </>
          )}
        </dl>
      </CollapsibleCard>

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
    </>
  );
};

const statusIcon = (status: HistoryVersion["status"]) => {
  if (status === "current") return <CircleDot className="size-4" />;
  if (status === "expired") return <Archive className="size-4" />;
  return <Clock className="size-4" />;
};
