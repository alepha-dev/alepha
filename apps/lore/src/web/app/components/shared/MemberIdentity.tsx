import { Badge } from "@alepha/ui/components/ui/badge";
import { useI18n } from "alepha/react/i18n";
import { Crown, User as UserIcon } from "lucide-react";

import type { Member } from "@/api/entities/members.ts";
import type { User } from "@/api/entities/users.ts";
import { displayName } from "@/web/app/services/displayName.ts";
import { publicFileUrl } from "@/web/app/services/fileUrl.ts";
import type { I18n } from "@/web/app/services/I18n.ts";

export type MemberWithUser = Member & { user: User };

/**
 * Resolve a member's avatar URL from their user account. Callers should
 * render an initials/icon placeholder when the result is null.
 */
export const memberPictureSrc = (member: MemberWithUser): string | null => {
  const fileId = member.user.picture;
  return fileId ? publicFileUrl(fileId) : null;
};

type Variant = "compact" | "name" | "card";

export interface MemberIdentityProps {
  member: MemberWithUser;
  /**
   * - `compact` — picture only. Dense surfaces (kanban cards, table rows).
   * - `name` — picture + name.
   * - `card` — larger picture + name. Members list rows.
   */
  variant?: Variant;
}

/**
 * Single shared way to render a project member anywhere in the app.
 * Identity always comes from the user account — there is no per-project
 * alias or avatar.
 *
 * No hover card. It used to open one showing the same picture and the same
 * name as the row it sat on, plus the Owner badge; a surface that repeats
 * what is under it is noise (feedback #2067). The one thing it alone showed,
 * the badge, is on the row now, wherever the name is.
 */
export const MemberIdentity = (props: MemberIdentityProps) => {
  const { member, variant = "compact" } = props;

  const { tr } = useI18n<I18n, "en">();

  const src = memberPictureSrc(member);
  const name = displayName(member.user, "") || String(tr("members.unknown"));

  return (
    <span
      data-testid="member-identity"
      className="inline-flex items-center gap-2"
    >
      <Avatar src={src} alt={name} size={variant === "card" ? 10 : 6} />
      {variant !== "compact" && (
        <span className="text-sm font-medium">{name}</span>
      )}
      {variant !== "compact" && member.owner && (
        <Badge variant="secondary" className="gap-1 py-0">
          <Crown className="size-3" />
          {tr("members.owner")}
        </Badge>
      )}
    </span>
  );
};

interface AvatarProps {
  src: string | null;
  alt: string;
  /**
   * Tailwind size class number (matches `size-N`).
   */
  size: 6 | 10;
}

const Avatar = (props: AvatarProps) => {
  const { src, alt, size } = props;
  const className =
    size === 10
      ? "size-10 rounded-md bg-muted flex items-center justify-center overflow-hidden"
      : "size-6 rounded-full bg-muted flex items-center justify-center overflow-hidden";
  if (src) {
    return (
      <span className={className}>
        <img alt={alt} src={src} className="size-full object-cover" />
      </span>
    );
  }
  return (
    <span className={className}>
      <UserIcon className={size === 10 ? "size-5" : "size-3.5"} />
    </span>
  );
};
