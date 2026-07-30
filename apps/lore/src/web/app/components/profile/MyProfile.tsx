import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { Badge } from "@alepha/ui/components/ui/badge";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { currentUserAtom } from "alepha/security";
import { Camera, GitBranch, Key, ShieldCheck, User } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import type { UserController } from "@/api/controllers/UserController.ts";
import type { User as UserEntity } from "@/api/entities/users.ts";
import { displayName } from "../../services/displayName.ts";

export interface MyProfileProps {
  user: UserEntity;
  identities: Array<{
    id: string;
    provider: string;
    providerUserId: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

const MyProfile = (props: MyProfileProps) => {
  const { user, identities } = props;
  const [, setUser] = useStore(currentUserAtom);
  const userApi = useClient<UserController>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toaster = useToast();
  const [uploading, setUploading] = useState(false);
  const [currentUser, setCurrentUser] = useState(user);
  const { l } = useI18n();

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
    if (provider === "credentials") return <Key className="size-3.5" />;
    return <User className="size-3.5" />;
  };

  const providerLabel = (provider: string) => {
    if (provider === "credentials") return "Password";
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  };

  return (
    <div className="flex flex-1 flex-col gap-6 py-4">
      {/* Hero */}
      <div className="flex items-center gap-6 rounded-lg border border-border bg-card p-6">
        <button
          type="button"
          onClick={handleAvatarClick}
          className="relative size-24 shrink-0 cursor-pointer"
        >
          {/* Only the image is clipped to a circle; the camera badge lives
              outside this wrapper so the round mask can't crop it. */}
          <div className="size-full overflow-hidden rounded-full border-2 border-border bg-muted">
            <FileImage
              id={currentUser.picture}
              public
              alt="avatar"
              className="size-full object-cover"
              fallback={
                <div className="flex size-full items-center justify-center">
                  <User className="size-12" />
                </div>
              }
            />
          </div>
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
          <span className="text-xl font-bold">{displayName(user)}</span>
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
            Member since {l(user.createdAt, { date: "LL" })}
          </span>
          {uploading && (
            <span className="text-xs text-muted-foreground">Uploading...</span>
          )}
        </div>
      </div>

      {/* Security */}
      <div className="flex w-full flex-col gap-3 rounded-md border border-border bg-card p-5 md:w-96">
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
  );
};

export default MyProfile;
