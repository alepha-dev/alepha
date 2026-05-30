import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { t } from "alepha";
import { useAlepha, useClient, useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import {
  Award,
  BookOpen,
  Circle,
  Lock,
  type LucideIcon,
  Trophy,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { CharacterController } from "@/api/controllers/CharacterController.ts";
import type { Character } from "@/api/entities/characters.ts";
import type { User } from "@/api/entities/users.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import {
  CharacterIdentity,
  type CharacterWithUser,
} from "@/web/app/components/shared/CharacterIdentity.tsx";
import { currentCampaignAtom } from "../../atoms/currentCampaignAtom.ts";
import { currentCampaignCharacterAtom } from "../../atoms/currentCampaignCharacterAtom.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";

interface AchievementCatalogEntry {
  key: string;
  label: string;
  description: string;
  icon: string;
  target: number;
  current: number;
  earned: boolean;
}

/**
 * Lucide icon name → component. The server only ships the name; the
 * mapping is here so the bundle stays predictable. Extend when new
 * achievements are added.
 */
const ACHIEVEMENT_ICONS: Record<string, LucideIcon> = {
  Award,
  BookOpen,
};

const renderAchievementIcon = (
  name: string,
  className: string,
): React.ReactNode => {
  const Icon = ACHIEVEMENT_ICONS[name] ?? Trophy;
  return <Icon className={className} />;
};

const MyCharacterPage = () => {
  const [campaign] = useStore(currentCampaignAtom);
  const [character] = useStore(currentCampaignCharacterAtom);
  const auth = useAuth();
  const characterApi = useClient<CharacterController>();
  const characterInfo = useInject(CharacterInfo);
  const alepha = useAlepha();
  const { tr, l } = useI18n<I18n, "en">();

  const user = auth.user as User | undefined;
  const fallbackName = displayName(user);

  const [catalog, setCatalog] = useState<AchievementCatalogEntry[]>([]);

  useEffect(() => {
    if (!campaign) return;
    characterApi
      .listAchievements({ params: { campaignId: campaign.id } })
      .then(setCatalog)
      .catch(() => setCatalog([]));
  }, [characterApi, campaign?.id]);

  // Radix Select rejects an empty-string item value (reserved as the
  // "no selection" sentinel). Use a non-empty placeholder we can map
  // back to null on submit.
  const NO_TITLE = "__none__";

  const form = useForm({
    initialValues: {
      name: character?.alias ?? fallbackName,
      avatar: character?.picture ?? user?.picture ?? null,
      title: character?.equippedTitle ?? NO_TITLE,
    },
    schema: t.object({
      name: t.string({
        title: tr("character.sheet.name"),
        maxLength: 60,
      }),
      avatar: t.optional(t.nullable(t.uuid())),
      title: t.optional(t.string()),
    }),
    handler: async (values) => {
      if (!campaign) return;
      const trimmed = values.name.trim();
      const nextAlias = trimmed && trimmed !== fallbackName ? trimmed : null;
      const nextTitle =
        values.title && values.title !== NO_TITLE ? values.title : null;
      const next = (await characterApi.updateMyCharacter({
        params: { campaignId: campaign.id },
        body: {
          alias: nextAlias,
          picture: values.avatar ?? null,
          equippedTitle: nextTitle,
        },
      })) as Character;
      alepha.store.set(currentCampaignCharacterAtom, next);
    },
  });

  if (!campaign || !character || !user) {
    return null;
  }

  const characterWithUser: CharacterWithUser = { ...character, user };

  const xp = character.xp;
  const level = characterInfo.getLevelByXp(xp);
  const maxForLevel = characterInfo.getMaxXpForLevel(
    Math.min(level, characterInfo.levels.length),
  );
  const currentForLevel = characterInfo.getCurrentXpForLevel(level, xp);
  const percentage =
    maxForLevel > 0
      ? Math.min(100, Math.floor((currentForLevel * 100) / maxForLevel))
      : 100;
  const gold = characterInfo.getGold(character.balance);
  const silver = characterInfo.getSilver(character.balance);

  // Earned set comes from the catalog response (server reconciles on
  // read), so it stays accurate even when the local character atom is
  // a tick behind a freshly-granted achievement.
  const earnedKeys = new Set(catalog.filter((a) => a.earned).map((a) => a.key));

  // Title dropdown: a "—" sentinel for "no title" (always present) plus
  // one entry per earned achievement (the server validates that
  // equippedTitle is in achievements). Catalog labels look better than
  // raw keys.
  const titleItems = [
    { value: NO_TITLE, label: "—" },
    ...catalog
      .filter((a) => a.earned)
      .map((a) => ({ value: a.key, label: a.label })),
  ];

  return (
    <div className="flex flex-col gap-8 p-4">
      {/* Header — identity + headline stats. No vertical padding on the
          card itself; the inner row sets its own spacing. */}
      <Card>
        <CardContent className="flex flex-col gap-4 px-4 py-0 sm:flex-row sm:items-center sm:gap-6">
          <CharacterIdentity character={characterWithUser} variant="card" />
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">
                {tr("character.sheet.level", { args: [String(level)] })}
              </span>
              <span className="text-muted-foreground text-xs">
                {l(currentForLevel)} / {l(maxForLevel)} XP
              </span>
            </div>
            <div className="bg-muted h-2 w-full overflow-hidden rounded">
              <div
                className="bg-primary h-full transition-all"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <div className="flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1">
                <Circle
                  className="size-2 fill-current"
                  style={{ color: "var(--color-gold)" }}
                />
                <span className="font-medium">{gold}g</span>
              </div>
              <div className="flex items-center gap-1">
                <Circle
                  className="size-2 fill-current"
                  style={{ color: "var(--color-silver)" }}
                />
                <span className="font-medium">{silver}s</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Identity — label + AutoForm (no surrounding Card, matches the
          Settings → General pattern). */}
      <div className="flex flex-col gap-2">
        <span className="text-sm">{tr("character.sheet.identity.title")}</span>
        <AutoForm
          form={form}
          layout="row"
          autoSave
          groups={[{ fields: ["avatar", "name", "title"] }]}
          fields={{
            avatar: {
              label: tr("character.sheet.identity.avatar"),
              upload: {
                accept: "image/*",
                maxSize: 2 * 1024 * 1024,
                bucket: "avatars",
              },
            },
            name: {
              label: tr("character.sheet.identity.name"),
              placeholder: fallbackName,
            },
            title: {
              label: tr("character.sheet.identity.title.label"),
              select: true,
              items: titleItems,
            },
          }}
        />
      </div>

      {/* Achievements — label + WoW/Steam-style grid of every catalog
          entry. Earned rows are warm + filled; locked rows are muted
          + dashed with a trailing Lock. */}
      <div className="flex flex-col gap-2">
        <span className="flex items-baseline gap-2 text-sm">
          {tr("character.sheet.achievements.title")}
          <span className="text-muted-foreground text-xs">
            {earnedKeys.size} / {catalog.length}
          </span>
        </span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {catalog.map((a) => {
            const isEarned = a.earned;
            const current = isEarned ? a.target : Math.min(a.current, a.target);
            const pct =
              a.target > 0
                ? Math.min(100, Math.floor((current * 100) / a.target))
                : 0;
            return (
              <div
                key={a.key}
                className={
                  isEarned
                    ? "flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-50/40 p-3 dark:bg-amber-900/10"
                    : "flex items-center gap-3 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-3 opacity-80"
                }
              >
                <div
                  className={
                    isEarned
                      ? "flex size-12 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                  }
                >
                  {renderAchievementIcon(a.icon, "size-6")}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={
                      isEarned
                        ? "text-sm font-semibold text-amber-700 dark:text-amber-400"
                        : "text-sm font-semibold text-muted-foreground"
                    }
                  >
                    {a.label}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {a.description}
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded">
                      <div
                        className={
                          isEarned
                            ? "h-full bg-amber-500 transition-all"
                            : "h-full bg-muted-foreground/40 transition-all"
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-muted-foreground text-[10px] tabular-nums">
                      {current} / {a.target}
                    </span>
                  </div>
                </div>
                {!isEarned && <Lock className="size-4 shrink-0 opacity-50" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MyCharacterPage;
