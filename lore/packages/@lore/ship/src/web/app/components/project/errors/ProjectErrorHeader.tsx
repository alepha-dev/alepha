import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Send,
} from "lucide-react";

import type { ProjectErrorDetail } from "../../../../../api/schemas/projectErrorDetailSchema.ts";
import { QUEST_STATUS_PREFIX } from "../../../../../api/schemas/projectErrorQuestStatus.ts";
import ErrorTrustIcon from "./ErrorTrustIcon.tsx";
import ProjectErrorOriginBadge from "./ProjectErrorOriginBadge.tsx";
import ProjectErrorSeenAgainBadge from "./ProjectErrorSeenAgainBadge.tsx";
import ProjectErrorStatusBadge from "./ProjectErrorStatusBadge.tsx";
import type { ProjectErrorVerbs } from "./useProjectErrorVerbs.ts";

export interface ProjectErrorHeaderProps {
  detail: ProjectErrorDetail;
  verbs: ProjectErrorVerbs;
  /**
   * Where the inbox is, and where an error's page is by its id.
   */
  inboxHref: string;
  errorHref: (id: number) => string;
  /**
   * Whether the project has Plan: forwarding files a quest, so both ways of
   * forwarding hide without it.
   */
  canForward: boolean;
  onIgnore: () => void;
}

/**
 * The top of an error's page: where it stands (the meta row), what it is
 * (the title), and what a member may do about it (the verbs).
 *
 * ⚠️ SECURITY: `name` and `message` come from an application's runtime.
 * Plain React text only.
 */
const ProjectErrorHeader = (props: ProjectErrorHeaderProps) => {
  const { tr } = useI18n<I18n, "en">();
  const { error, kind, previousId, nextId } = props.detail;
  const verbs = props.verbs;
  const forwarded = error.status.startsWith(QUEST_STATUS_PREFIX);
  // Resolve and forward are for an error still in the inbox, as there.
  const open = error.status === "open";

  return (
    <header className="flex flex-col gap-3" data-testid="error-header">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={props.inboxHref}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
          data-testid="error-back"
        >
          <ArrowLeft className="size-3.5" />
          {tr("errors.page.back")}
        </Link>
        <span
          className="text-muted-foreground font-mono text-xs"
          data-testid="error-number"
        >
          {tr("errors.dialog.number", { args: [String(error.id)] })}
        </span>
        <ProjectErrorStatusBadge status={error.status} showOpen />
        {error.seenAgain && (
          <ProjectErrorSeenAgainBadge resolvedAt={error.resolvedAt} />
        )}
        <ProjectErrorOriginBadge origin={error.origin} kind={kind} />
        {(error.trustedAt || open) && (
          <ErrorTrustIcon
            trusted={!!error.trustedAt}
            trustedByName={error.trustedByName}
            onArrival={!!error.trustedAt && !error.trustedBy}
          />
        )}
        {/* The walk through the open inbox, in its order. Absent on an
            error that is not open: it is in no queue. */}
        {(previousId !== undefined || nextId !== undefined) && (
          <span className="ml-auto flex items-center gap-1">
            <Button
              variant="minimal"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={tr("errors.page.previous")}
              data-testid="error-previous"
              disabled={previousId === undefined}
              href={
                previousId === undefined
                  ? undefined
                  : props.errorHref(previousId)
              }
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="minimal"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={tr("errors.page.next")}
              data-testid="error-next"
              disabled={nextId === undefined}
              href={nextId === undefined ? undefined : props.errorHref(nextId)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1
            className="text-lg leading-snug font-bold break-words"
            data-testid="error-name"
          >
            {error.name}
          </h1>
          <p
            className="text-muted-foreground text-sm break-words whitespace-pre-wrap"
            data-testid="error-message"
          >
            {error.message}
          </p>
        </div>

        {/* A member without `error:triage` reads the page and is offered no
            verb, as in the inbox. */}
        {verbs.canTriage && (
          <div className="flex shrink-0 items-center gap-1">
            {open && (
              <Button
                size="sm"
                disabled={verbs.busy}
                onClick={() => void verbs.resolve.run()}
                data-testid="error-resolve"
              >
                <CheckCircle2 className="size-4" />
                {tr("errors.action.resolve")}
              </Button>
            )}
            {open && props.canForward && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outlined"
                      size="sm"
                      data-testid="error-forward"
                    />
                  }
                  disabled={verbs.busy}
                >
                  <Send className="size-4" />
                  {tr("errors.action.forward")}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem
                    onClick={() => void verbs.forward.run()}
                    data-testid="error-forward-new"
                  >
                    {tr("errors.action.forwardNew")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void verbs.link.run()}
                    data-testid="error-forward-existing"
                  >
                    {tr("errors.action.forwardExisting")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="minimal"
                    size="sm"
                    className="h-8 w-8 p-0"
                    aria-label={tr("errors.action.more")}
                    data-testid="error-more"
                  />
                }
                disabled={verbs.busy}
              >
                <Ellipsis className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                {/* Trust moves on an error still in triage, as in the
                    inbox: a resolved or forwarded one is decided. */}
                {!forwarded &&
                  error.status !== "resolved" &&
                  (error.trustedAt ? (
                    <DropdownMenuItem
                      onClick={() => void verbs.untrust.run()}
                      data-testid="error-untrust"
                    >
                      {tr("errors.action.untrust")}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      onClick={() => void verbs.trust.run()}
                      data-testid="error-trust"
                    >
                      {tr("errors.action.trust")}
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuItem
                  onClick={props.onIgnore}
                  data-testid="error-ignore"
                >
                  {tr("errors.action.ignore")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => void verbs.remove.run()}
                  data-testid="error-delete"
                >
                  {tr("errors.action.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </header>
  );
};

export default ProjectErrorHeader;
