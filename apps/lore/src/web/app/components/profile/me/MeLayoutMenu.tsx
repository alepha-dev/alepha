import { useRouter } from "alepha/react/router";
import {
  KeyRound,
  Mail,
  MessageSquareWarning,
  Plug,
  RadioTower,
  ShieldCheck,
  User,
} from "lucide-react";
import MeLayoutNavLink from "./MeLayoutNavLink.tsx";
import type { MeRouter } from "./MeRouter.ts";

const MeLayoutMenu = () => {
  const meRouter = useRouter<MeRouter>();

  return (
    <div className="flex w-full flex-col gap-1 rounded-md border border-border bg-card p-2">
      <span className="hidden px-2 pt-1 text-xs text-muted-foreground md:block">
        General
      </span>
      <MeLayoutNavLink
        href={meRouter.path("profile")}
        icon={<User className="size-4" />}
      >
        Profile
      </MeLayoutNavLink>
      <MeLayoutNavLink
        href={meRouter.path("invitations")}
        icon={<Mail className="size-4" />}
      >
        Invitations
      </MeLayoutNavLink>
      <MeLayoutNavLink
        href={meRouter.path("myFeedback")}
        icon={<MessageSquareWarning className="size-4" />}
      >
        Feedback
      </MeLayoutNavLink>
      <span className="hidden px-2 pt-2 text-xs text-muted-foreground md:block">
        Security
      </span>
      <MeLayoutNavLink
        href={meRouter.path("identities")}
        icon={<ShieldCheck className="size-4" />}
      >
        Identities
      </MeLayoutNavLink>
      <MeLayoutNavLink
        href={meRouter.path("sessions")}
        icon={<RadioTower className="size-4" />}
      >
        Sessions
      </MeLayoutNavLink>
      <MeLayoutNavLink
        href={meRouter.path("apiKeys")}
        icon={<KeyRound className="size-4" />}
      >
        API Keys
      </MeLayoutNavLink>
      <MeLayoutNavLink
        href={meRouter.path("connections")}
        icon={<Plug className="size-4" />}
      >
        Connected apps
      </MeLayoutNavLink>
    </div>
  );
};

export default MeLayoutMenu;
