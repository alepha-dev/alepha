import { Badge } from "@alepha/ui/components/ui/badge";
import { useClient, useInject, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { currentUserAtom } from "alepha/security";
import {
  Camera,
  Circle,
  Flame,
  GitBranch,
  Key,
  ShieldCheck,
  Star,
  Swords,
  User,
} from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import type { UserController } from "@/api/controllers/UserController.ts";
import type { User as UserEntity } from "@/api/entities/users.ts";
import { CharacterInfo } from "@/api/services/CharacterInfo.ts";
import { displayName } from "../../services/displayName.ts";
import { Toaster } from "../../services/Toaster.ts";

export interface MyProfileProps {
  user: UserEntity;
  characters: Array<{
    id: number;
    campaignId: number;
    campaignTitle: string;
    xp: number;
    balance: number;
    owner?: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  identities: Array<{
    id: string;
    provider: string;
    providerUserId: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

const MyProfile = (props: MyProfileProps) => {
  const { user, characters, identities } = props;
  const [, setUser] = useStore(currentUserAtom);
  const characterInfo = useInject(CharacterInfo);
  const userApi = useClient<UserController>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toaster = useInject(Toaster);
  const [uploading, setUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState(user);
  const { l } = useI18n();

  const totalXP = characters.reduce((sum, char) => sum + char.xp, 0);
  const totalGold = characters.reduce(
    (sum, char) => sum + characterInfo.getGold(char.balance),
    0,
  );
  const highestLevel =
    characters.length > 0
      ? Math.max(
          ...characters.map((char) => characterInfo.getLevelByXp(char.xp)),
        )
      : 0;

  const handleAvatarClick = () => fileInputRef.current?.click();

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const updatedUser = await userApi.updateAvatar({ body: { file } });
      setCurrentUser(updatedUser);
      setUser({ ...user, picture: updatedUser.picture });
      toaster.show("Avatar updated successfully", "success");
    } catch (error) {
      toaster.show(
        (error as Error)?.message || "Failed to update avatar",
        "danger",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const providerIcon = (provider: string) => {
    if (provider === "github") return <GitBranch className="size-3.5" />;
    if (provider === "usernamePassword") return <Key className="size-3.5" />;
    return <User className="size-3.5" />;
  };

  const providerLabel = (provider: string) => {
    if (provider === "usernamePassword") return "Password";
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  };

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      {/* Hero */}
      <div className="flex items-center gap-6 rounded-lg border border-border bg-card p-6">
        <button
          type="button"
          onClick={handleAvatarClick}
          className="relative size-24 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-border bg-muted"
        >
          {currentUser.picture ? (
            <img
              src={`/api/files/${currentUser.picture}`}
              alt="avatar"
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center">
              <User className="size-12" />
            </div>
          )}
          <div className="absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full border-2 border-border bg-card">
            <Camera className="size-3.5" />
          </div>
        </button>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
        />

        <div className="flex flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold">{displayName(user)}</span>
            {highestLevel > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Star className="size-3" />
                Lv. {highestLevel}
              </Badge>
            )}
          </div>
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {user.roles.map((role: string) => (
              <Badge
                key={role}
                variant={role === "admin" ? "destructive" : "outline"}
                className="text-xs"
              >
                {role}
              </Badge>
            ))}
          </div>
          <span className="mt-1 text-xs text-muted-foreground">
            Adventurer since {l(user.createdAt, { date: "LL" })}
          </span>
          {uploading && (
            <span className="text-xs text-muted-foreground">Uploading...</span>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<Flame className="size-4 text-orange-500" />}
          label="Experience"
          value={`${l(totalXP)} XP`}
        />
        <StatCard
          icon={
            <Circle
              className="size-3"
              fill="var(--color-gold)"
              color="var(--color-gold)"
            />
          }
          label="Treasury"
          value={`${l(totalGold)} gold`}
        />
        <StatCard
          icon={<Swords className="size-4 text-teal-500" />}
          label="Characters"
          value={String(characters.length)}
        />
      </div>

      {/* Characters + Security */}
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="flex flex-1 flex-col gap-3 rounded-md border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Swords className="size-4" />
            <span className="text-sm font-semibold">Active Characters</span>
          </div>
          {characters.length === 0 && (
            <span className="text-sm text-muted-foreground">
              No characters yet. Join a campaign to begin your adventure.
            </span>
          )}
          <div className="flex flex-col gap-2">
            {characters.slice(0, 5).map((char) => {
              const level = characterInfo.getLevelByXp(char.xp);
              const maxXp = characterInfo.getMaxXpForLevel(level);
              const currentXp = characterInfo.getCurrentXpForLevel(
                level,
                char.xp,
              );
              const progress = Math.round((currentXp / maxXp) * 100);
              const gold = characterInfo.getGold(char.balance);

              return (
                <div
                  key={char.id}
                  className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">
                        {char.campaignTitle}
                      </span>
                      {char.owner && (
                        <Badge variant="secondary" className="text-xs">
                          Owner
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="flex items-center gap-1 text-xs font-semibold"
                        style={{ color: "var(--color-gold)" }}
                      >
                        {gold}
                        <Circle
                          className="size-3"
                          fill="var(--color-gold)"
                          color="var(--color-gold)"
                        />
                      </span>
                      <Badge variant="outline" className="text-xs">
                        Lv. {level}
                      </Badge>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {characters.length > 5 && (
            <span className="text-center text-xs text-muted-foreground">
              +{characters.length - 5} more characters
            </span>
          )}
        </div>

        <div className="flex w-full flex-col gap-3 rounded-md border border-border bg-card p-5 md:w-72 md:min-w-72">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            <span className="text-sm font-semibold">Security</span>
          </div>
          <div className="flex flex-col gap-2">
            {identities.map((identity) => (
              <div
                key={identity.id}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2"
              >
                {providerIcon(identity.provider)}
                <span className="flex-1 text-sm">
                  {providerLabel(identity.provider)}
                </span>
                <span className="size-2 rounded-full bg-green-500" />
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between border-border border-t pt-2">
            <span className="text-xs text-muted-foreground">Last activity</span>
            <span className="text-xs text-muted-foreground">
              {l(user.updatedAt, { date: "ll" })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyProfile;

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}

const StatCard = (props: StatCardProps) => {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {props.icon}
        <span className="text-xs font-semibold uppercase text-muted-foreground">
          {props.label}
        </span>
      </div>
      <span className="text-lg font-bold">{props.value}</span>
    </div>
  );
};
