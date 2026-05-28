import { Badge } from "@alepha/ui/components/ui/badge";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@alepha/ui/components/ui/hover-card";
import { useInject } from "alepha/react";
import { Crown, User as UserIcon } from "lucide-react";
import type { Character } from "@/api/entities/characters.ts";
import type { User } from "@/api/entities/users.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { displayName } from "@/web/app/services/displayName.ts";

export type CharacterWithUser = Character & { user: User };

/**
 * Resolve a character's avatar URL with the fallback chain
 * `character.picture` → `character.user.picture` → null. Callers should
 * render an initials/icon placeholder when the result is null.
 */
export const characterPictureSrc = (
  character: CharacterWithUser,
): string | null => {
  const fileId = character.picture ?? character.user.picture;
  return fileId ? `/api/files/${fileId}` : null;
};

/**
 * Effective display name: per-campaign `alias` overrides the user's name.
 */
const characterDisplayName = (character: CharacterWithUser): string =>
  character.alias?.trim() || displayName(character.user, "") || "Unknown";

type Variant = "compact" | "name" | "card";

interface CharacterIdentityProps {
  character: CharacterWithUser;
  /**
   * - `compact` — picture only. Dense surfaces (kanban cards, table rows).
   * - `name` — picture + alias.
   * - `card` — picture + alias + title + level. Roster rows, settings list.
   */
  variant?: Variant;
}

/**
 * Single shared way to render a Character anywhere in the app. Replaces
 * ad-hoc `<img src=/api/files/${user.picture}>` patterns and unifies the
 * hover-card identity reveal. See folio "Character — vision and economy".
 */
export const CharacterIdentity = ({
  character,
  variant = "compact",
}: CharacterIdentityProps) => {
  const characterInfo = useInject(CharacterInfo);

  const src = characterPictureSrc(character);
  const name = characterDisplayName(character);
  const level = characterInfo.getLevelByXp(character.xp);
  const title = character.equippedTitle ?? undefined;
  const achievementCount = character.achievements?.length ?? 0;

  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <span
            data-testid="character-identity"
            className="inline-flex items-center gap-2"
          />
        }
      >
        <Avatar src={src} alt={name} size={variant === "card" ? 10 : 6} />
        {variant !== "compact" && (
          <span className="text-sm font-medium">{name}</span>
        )}
        {variant === "card" && (
          <>
            {title && (
              <span className="text-muted-foreground text-xs">{title}</span>
            )}
            <span className="text-muted-foreground text-xs">Lv. {level}</span>
          </>
        )}
      </HoverCardTrigger>
      <HoverCardContent align="start">
        <div className="flex items-start gap-3">
          <Avatar src={src} alt={name} size={10} />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">{name}</span>
              {character.owner && (
                <Badge variant="secondary" className="gap-1 py-0">
                  <Crown className="size-3" />
                  Owner
                </Badge>
              )}
            </div>
            {title && (
              <span className="text-muted-foreground text-xs">{title}</span>
            )}
            <span className="text-muted-foreground text-xs">Lv. {level}</span>
            {achievementCount > 0 && (
              <span className="text-muted-foreground text-xs">
                🏆 {achievementCount} achievement
                {achievementCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

interface AvatarProps {
  src: string | null;
  alt: string;
  /** Tailwind size class number (matches `size-N`). */
  size: 6 | 10;
}

const Avatar = ({ src, alt, size }: AvatarProps) => {
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
