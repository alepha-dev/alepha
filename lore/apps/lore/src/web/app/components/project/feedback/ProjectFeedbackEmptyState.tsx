import { buttonVariants } from "@alepha/ui/components/ui/button";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  Circle,
  CircleCheck,
  CircleX,
  type LucideIcon,
  MousePointerClick,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { ReactElement } from "react";
import type { FeedbackResource } from "@/api/schemas/feedbackResourceSchema.ts";
import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

export interface ProjectFeedbackEmptyStateProps {
  /**
   * Which filter the list is showing. Decides the whole message, because an
   * empty Accepted tab and an empty Pending tab mean opposite things.
   */
  status: FeedbackResource["status"];

  /**
   * Whether the list beside this pane has rows in it. The distinction is the
   * entire point of this component: with rows, nothing is selected yet; with
   * none, there is nothing to select and saying otherwise is a dead end.
   */
  hasItems: boolean;
}

/**
 * The detail pane with no feedback open.
 *
 * It used to be one message for both states this pane can be in: an `Inbox`
 * glyph and "Select an item from the list" - the same glyph the list beside
 * it shows when it is empty, next to an instruction that could not be
 * followed, because on a desktop viewport a selection is only ever absent
 * when the list has nothing in it. `ProjectFeedback` auto-selects the first
 * row on load and after every reload, so "nothing selected" and "nothing to
 * select" arrive together and the pane was answering the rarer one.
 *
 * That rarer one is real, though, and is why `hasItems` exists rather than
 * this branching on `status` alone. Below `md` the list and the detail swap
 * places, Back clears the selection to bring the list forward, and widening
 * the window past `md` from there leaves a populated list with nothing open.
 *
 * The empty case takes the active filter's own icon rather than a generic
 * one. It costs nothing, it disambiguates a pane that would otherwise look
 * identical on all three tabs, and it is the same vocabulary as the segmented
 * control above and the rows in the list.
 *
 * The form link is on the Pending tab only. "Nobody has sent anything" is the
 * one empty state with an action behind it; an empty Accepted tab means the
 * feedback exists and has not been triaged, which this pane cannot help with.
 */
const ProjectFeedbackEmptyState = (
  props: ProjectFeedbackEmptyStateProps,
): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const [project] = useStore(currentProjectAtom);

  if (props.hasItems) {
    return (
      <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <MousePointerClick className="size-10 opacity-50" />
        <p className="text-sm">{tr("feedback.empty.selectOne")}</p>
      </div>
    );
  }

  const Icon = STATUS_ICONS[props.status];

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      {/*
        A tinted tile rather than a bare glyph. At this size a 40px outline
        icon floating in a very large empty pane reads as something failing
        to load; giving it a surface makes it read as a placed element.
      */}
      <div className="bg-primary/10 text-primary flex size-16 items-center justify-center rounded-2xl">
        <Icon className="size-7" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-base font-medium">
          {tr(`feedback.empty.detail.${props.status}.title` as const)}
        </p>
        <p className="text-muted-foreground max-w-xs text-sm">
          {tr(`feedback.empty.detail.${props.status}.body` as const)}
        </p>
      </div>
      {props.status === "pending" && project && (
        /*
          A real anchor, not a button with `router.push`: this is a
          destination, so it keeps middle-click and open-in-new-tab. The
          owner most often wants the URL itself, to hand to somebody else.
        */
        <a
          href={router.path("projectFeedbackRequest", {
            params: { projectSlug: project.slug },
          })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <SquareArrowOutUpRight className="size-3.5" />
          {tr("feedback.empty.detail.openForm")}
        </a>
      )}
    </div>
  );
};

export default ProjectFeedbackEmptyState;

/*
 * The same three glyphs the segmented control and `ProjectFeedbackCard` use,
 * so a status is one shape everywhere on this screen.
 */
const STATUS_ICONS: Record<FeedbackResource["status"], LucideIcon> = {
  pending: Circle,
  accepted: CircleCheck,
  rejected: CircleX,
};
