import { useSidebar } from "@alepha/ui/components/ui/sidebar";
import { useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { Link, useRouter } from "alepha/react/router";
import { Circle, Crown, User as UserIcon } from "lucide-react";
import type { User } from "@/api/entities/users.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import type { AppRouter } from "@/web/app/AppRouter.ts";
import { currentCampaignAtom } from "@/web/app/atoms/currentCampaignAtom.ts";
import { currentCampaignCharacterAtom } from "@/web/app/atoms/currentCampaignCharacterAtom.ts";
import {
  type CharacterWithUser,
  characterPictureSrc,
} from "@/web/app/components/shared/CharacterIdentity.tsx";
import { displayName } from "@/web/app/services/displayName.ts";

/**
 * Compact character row mounted in the AppShell `sidebarFooter`. The
 * whole row is a Link to the Character Sheet — replaces the standalone
 * "Character Sheet" entry in the Activity nav group.
 *
 * Renders: avatar (with initials fallback), name, level + rank pill, and
 * the gold count. Intentionally no XP — the ExperienceBar already
 * surfaces XP under the page content, so the sidebar card focuses on the
 * persistent identity + economy signals.
 */
const CharacterSidebarCard = () => {
  const [campaign] = useStore(currentCampaignAtom);
  const [character] = useStore(currentCampaignCharacterAtom);
  const auth = useAuth();
  const characterInfo = useInject(CharacterInfo);
  const router = useRouter<AppRouter>();
  const { state, isMobile } = useSidebar();
  const collapsed = state === "collapsed" && !isMobile;

  const user = auth.user as User | undefined;
  if (!campaign || !character || !user) return null;

  const characterWithUser: CharacterWithUser = { ...character, user };
  const avatarSrc = characterPictureSrc(characterWithUser);
  const name = character.alias?.trim() || displayName(user, "") || "Character";
  const level = characterInfo.getLevelByXp(character.xp);
  const gold = characterInfo.getGold(character.balance);
  const silver = characterInfo.getSilver(character.balance);
  // Real rank: Owner vs Member, the access-rights split the rest of the
  // app already gates on (CampaignSecurityService.assertOwner /
  // assertMember). Owners get the Crown badge next to their name —
  // matches the convention in CharacterIdentity + Settings.
  const isOwner = character.owner === true;

  const href = router.path("campaignMyCharacter", {
    params: { campaignId: String(campaign.id) },
  });

  return (
    <Link
      href={href}
      title={collapsed ? `${name} · Lv.${level}` : undefined}
      className={`group flex items-center gap-2 rounded-md py-1.5 hover:bg-sidebar-accent/40 ${
        collapsed ? "justify-center px-0" : "px-2"
      }`}
    >
      <span className="bg-muted/40 flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {avatarSrc ? (
          <img alt={name} src={avatarSrc} className="size-full object-cover" />
        ) : (
          <UserIcon className="size-4 opacity-70" />
        )}
      </span>
      {collapsed ? null : (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1 truncate text-sm font-medium">
            <span className="truncate">{name}</span>
            {isOwner && (
              <Crown
                className="size-3 shrink-0 text-amber-600 dark:text-amber-400"
                aria-label="Owner"
              />
            )}
          </span>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="tabular-nums">Lv.{level}</span>
            {/* Gold + silver, mirroring the quest Rewards block: number
              first, then a filled circle in the matching colour. */}
            <span className="flex items-center gap-1 tabular-nums">
              {gold}
              <Circle
                className="size-2"
                fill="var(--color-gold)"
                color="var(--color-gold)"
              />
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              {silver}
              <Circle
                className="size-2"
                fill="var(--color-silver)"
                color="var(--color-silver)"
              />
            </span>
          </div>
        </div>
      )}
    </Link>
  );
};

export default CharacterSidebarCard;
