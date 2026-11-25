import {
  Badge,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  UserAvatar,
  cn,
} from "@alepha/ui";
import type { ReactNode } from "react";

import { displayName } from "../../services/displayName.ts";
import type { ProjectUser } from "./useProjectUsers.ts";

export interface ProjectUserChipProps {
  /**
   * The member, from `useProjectUsers`. Absent draws `fallback` as plain
   * text: there is nobody to show a card for.
   */
  user?: ProjectUser;
  /**
   * What stands in for a person who is not a member to show: "System", a
   * former member, a dash.
   */
  fallback?: ReactNode;
  /**
   * A line under the rank in the card, such as when they took the quest.
   */
  detail?: ReactNode;
  /**
   * The avatar's size classes. Defaults to `size-6`, a table row's.
   */
  className?: string;
}

/**
 * A person in a list (#Q3829): their avatar, which always exists since it
 * falls back to two generated initials, and on hover or keyboard focus a
 * card with the avatar, full name, username and rank in the project.
 *
 * The card reads as one identity, then a detail (#Q4316): the name in bold
 * with the rank as a small tag beside it, the `@handle` under them, and a
 * detail ("Assigned 4 minutes ago") smaller, muted and set apart.
 *
 * The trigger is a button, so it takes focus and opens the card from the
 * keyboard as from the pointer; its accessible name is the whole card's
 * text (name, username, rank), so a screen reader says what a sighted
 * reader sees.
 *
 * ## Where the plain name stays
 *
 * The chip is for columns and lists of people. Dense prose keeps the name
 * as text: a sentence in a comment or a quest's history ("Ada accepted
 * it"), a mention, a notification, a breadcrumb, a filter's options, and
 * anything read aloud or copied as text. An avatar in the middle of a
 * sentence reads worse than the name it replaces.
 */
export const ProjectUserChip = (props: ProjectUserChipProps) => {
  const user = props.user;
  if (!user) {
    return (
      <span className="text-muted-foreground text-sm">{props.fallback}</span>
    );
  }
  const name = displayName(user, user.id);
  const handle = user.username ? `@${user.username}` : undefined;
  const label = [name, handle !== `@${name}` ? handle : undefined, user.rank]
    .filter(Boolean)
    .join(", ");

  return (
    <HoverCard>
      <HoverCardTrigger
        delay={200}
        render={
          <button
            type="button"
            aria-label={label}
            data-testid="project-user-chip"
            className="focus-visible:ring-ring/50 inline-flex shrink-0 rounded-full outline-none focus-visible:ring-[3px]"
          />
        }
      >
        <UserAvatar
          public
          user={user}
          alt=""
          className={cn("size-6", props.className)}
        />
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        className="flex w-auto max-w-72 items-center gap-3"
        data-testid="project-user-card"
      >
        <UserAvatar public user={user} alt="" className="size-10" />
        <div className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="truncate font-semibold"
              data-testid="project-user-card-name"
            >
              {name}
            </span>
            {user.rank && (
              <Badge
                variant="tint"
                tone="neutral"
                className="shrink-0 px-1.5 py-0 text-[10px] leading-4 font-normal"
                data-testid="project-user-card-rank"
              >
                {user.rank}
              </Badge>
            )}
          </span>
          {handle && handle !== `@${name}` && (
            <span
              className="text-muted-foreground truncate text-xs"
              data-testid="project-user-card-handle"
            >
              {handle}
            </span>
          )}
          {props.detail && (
            <span
              className="text-muted-foreground/80 mt-1 truncate text-[11px]"
              data-testid="project-user-card-detail"
            >
              {props.detail}
            </span>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};
