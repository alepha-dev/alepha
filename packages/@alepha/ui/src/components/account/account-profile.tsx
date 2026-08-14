import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Input } from "@alepha/ui/components/ui/input";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type { MyProfile, MyProfileController } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Camera, Trash2, User } from "lucide-react";
import { type ChangeEvent, type FormEvent, useRef, useState } from "react";

export interface AccountProfileProps {
  /**
   * Supplied by the route loader. Optional so the page can also be rendered
   * standalone in a story or a test.
   */
  profile?: MyProfile;
}

/**
 * Who you are: avatar, name, and the read-only facts about the account.
 *
 * Email is shown but not editable — changing it is a verification flow, not a
 * profile edit, and `updateMyProfile` deliberately refuses it. Rather than
 * render a disabled input with no explanation, the row says so.
 */
const AccountProfile = (props: AccountProfileProps) => {
  const api = useClient<MyProfileController>();
  const toaster = useToast();
  const { l } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<MyProfile | undefined>(props.profile);
  const [firstName, setFirstName] = useState(props.profile?.firstName ?? "");
  const [lastName, setLastName] = useState(props.profile?.lastName ?? "");
  const [username, setUsername] = useState(props.profile?.username ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  if (!profile) {
    return null;
  }

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const updated = await api.updateMyProfile({
        body: {
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          username: username || undefined,
        },
      });
      setProfile(updated);
      toaster.show("Profile updated", "success");
    } catch (error: any) {
      // The username-taken 409 arrives here with its own message, which is
      // the only one worth showing.
      toaster.show(error?.message ?? "Could not update your profile", "danger");
    } finally {
      setSaving(false);
    }
  };

  const onPickAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      setProfile(await api.updateMyAvatar({ body: { file } }));
      toaster.show("Avatar updated", "success");
    } catch (error: any) {
      toaster.show(error?.message ?? "Could not upload that image", "danger");
    } finally {
      setUploading(false);
      // Reset so picking the same file again still fires a change event.
      if (fileInput.current) {
        fileInput.current.value = "";
      }
    }
  };

  const removeAvatar = async () => {
    setUploading(true);
    try {
      setProfile(await api.deleteMyAvatar());
    } catch (error: any) {
      toaster.show(error?.message ?? "Could not remove your avatar", "danger");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <SettingsSection title="Profile picture">
        <SettingsRow
          label="Avatar"
          description="PNG, JPEG, GIF or WebP, up to 5 MB."
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              aria-label="Change avatar"
              className="relative size-14 shrink-0 cursor-pointer"
            >
              {/* Only the image is clipped to a circle; the camera badge sits
                  outside the wrapper so the round mask cannot crop it. */}
              <div className="size-full overflow-hidden rounded-full border bg-muted">
                <FileImage
                  id={profile.picture}
                  public
                  alt=""
                  className="size-full object-cover"
                  fallback={
                    <div className="flex size-full items-center justify-center">
                      <User className="size-6" />
                    </div>
                  }
                />
              </div>
              <div className="absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full border bg-card">
                <Camera className="size-3" />
              </div>
            </button>
            {profile.picture ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={removeAvatar}
                disabled={uploading}
              >
                <Trash2 className="size-4" />
                Remove
              </Button>
            ) : null}
          </div>
        </SettingsRow>
      </SettingsSection>

      <input
        type="file"
        ref={fileInput}
        onChange={onPickAvatar}
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
      />

      <form onSubmit={save}>
        <SettingsSection title="Name">
          <SettingsRow
            label="Username"
            htmlFor="accountUsername"
            description="Unique across this site."
          >
            <Input
              id="accountUsername"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              className="sm:w-64"
            />
          </SettingsRow>
          <SettingsRow label="First name" htmlFor="accountFirstName">
            <Input
              id="accountFirstName"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoComplete="given-name"
              className="sm:w-64"
            />
          </SettingsRow>
          <SettingsRow label="Last name" htmlFor="accountLastName">
            <Input
              id="accountLastName"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              autoComplete="family-name"
              className="sm:w-64"
            />
          </SettingsRow>
          <SettingsRow label="">
            <Button type="submit" disabled={saving}>
              Save
            </Button>
          </SettingsRow>
        </SettingsSection>
      </form>

      <SettingsSection title="Account">
        <SettingsRow
          label="Email"
          description="Changing your email needs verification — it is not a profile edit."
        >
          <span className="text-muted-foreground text-sm">
            {profile.email ?? "—"}
          </span>
        </SettingsRow>
        <SettingsRow label="Roles">
          <div className="flex flex-wrap gap-1">
            {profile.roles.length > 0 ? (
              profile.roles.map((role) => (
                <Badge key={role} variant="outline" className="text-xs">
                  {role}
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>
        </SettingsRow>
        <SettingsRow label="Member since">
          <span className="text-muted-foreground text-sm">
            {String(l(profile.createdAt, { date: "LL" }))}
          </span>
        </SettingsRow>
      </SettingsSection>
    </>
  );
};

export default AccountProfile;
