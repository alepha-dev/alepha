import {
  Activity,
  AppWindow,
  BookOpen,
  Flag,
  FolderKanban,
  Grid3x2,
  Inbox,
  KeyRound,
  Layers,
  Server,
  User,
} from "lucide-react";
import type { ReactElement } from "react";

/**
 * The icon a line of the activity panel leads with, by resource kind.
 *
 * The same icon the project's sidebar gives that kind (`capabilityNav.ts`),
 * so a quest line and the Quests entry read as the same thing. A kind with no
 * entry there gets the Activity icon rather than a guess: a new `$audit` type
 * reaches this panel the moment it is declared.
 */
export const homeActivityIcon = (type: string): ReactElement => {
  switch (type) {
    case "quest":
      return <Grid3x2 className="size-4" />;
    case "epic":
      return <Layers className="size-4" />;
    case "release":
      return <Flag className="size-4" />;
    case "folio":
      return <BookOpen className="size-4" />;
    case "feedback":
      return <Inbox className="size-4" />;
    case "member":
      return <User className="size-4" />;
    case "sigil":
      return <KeyRound className="size-4" />;
    case "app":
      return <AppWindow className="size-4" />;
    case "estate":
      return <Server className="size-4" />;
    case "project":
      return <FolderKanban className="size-4" />;
    default:
      return <Activity className="size-4" />;
  }
};
