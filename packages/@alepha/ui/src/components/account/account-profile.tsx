import { AutoForm } from "@alepha/ui/components/auto-form/auto-form";
import { FileImage } from "@alepha/ui/components/file-image/file-image";
import { SettingsRow } from "@alepha/ui/components/settings/settings-row";
import { SettingsSection } from "@alepha/ui/components/settings/settings-section";
import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import type {
  MyAvatarController,
  MyProfile,
  MyProfileController,
  RealmConfig,
} from "alepha/api/users";
import { updateMyProfileBodySchema } from "alepha/api/users";
import { useClient } from "alepha/react";
import { useForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { AtSign, Camera, Trash2, User } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";

export interface AccountProfileProps {
  /**
   * Supplied by the route loader. Optional so the page can also be rendered
   * standalone in a story or a test.
   */
  profile?: MyProfile;

  /**
   * Supplied by the route loader, and read for one thing: whether this realm
   * collects usernames at all.
   *
   * Optional for the same reason `profile` is. Absent, the username field
   * renders — the historical behaviour, and the right guess for a realm nobody
   * described.
   */
  realmConfig?: RealmConfig;
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
  const avatarApi = useClient<MyAvatarController>();
  const toaster = useToast();
  const { l } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<MyProfile | undefined>(props.profile);
  const [uploading, setUploading] = useState(false);

  /*
   * Does this realm have usernames at all?
   *
   * The avatar section above reads its switch through `can()`, because a realm
   * with `features.avatars` off registers no avatar action and the capability
   * is simply absent from `/api/_links`. That cannot work here:
   * `updateMyProfile` is the same call that saves first and last name, so it
   * exists in every realm and its presence says nothing about usernames.
   *
   * The realm's own `settings.username` is the switch, and `"none"` is the
   * only value that hides the row: it is the one that means this realm has no
   * such thing as a username, so there is nothing to show and nothing the user
   * could set.
   *
   * Without this, a `"none"` realm did not merely render a pointless field:
   * `?? ""` seeded an empty string into a column that is `.optional()` but
   * `minLength: 3`, `FormModel` decodes its initial values on construction,
   * and the whole page died at `useForm` with "Too small: expected string to
   * have >=3 characters at /username" — before anything rendered. `apps/examples/shop`
   * is such a realm, and `"none"` is also the framework default, so this is
   * what any new app hits first.
   *
   * ⚠️ `auth-register.tsx` excludes `"email"` here as well, and this
   * deliberately does not. In that mode `RegistrationService` derives the
   * handle from the address and drops whatever the client sent, so the
   * registration form is right to hide a field the user does not choose — but
   * the account page is where an existing, already-derived username is shown,
   * and `apps/lore` runs exactly this mode. Whether editing it there should be
   * possible at all is a real question (a rename desyncs it from the email
   * that produced it, and `updateMyProfile` does not re-run the slugger), but
   * it is a separate one from "this realm has no usernames", and answering it
   * by quietly deleting the field is not the place to start.
   */
  const hasUsername = props.realmConfig?.settings?.username !== "none";

  /**
   * Validated against the server's own body schema, so "3 to 30 characters"
   * is enforced before the request rather than only by the 400 that comes
   * back — and is stated in exactly one place.
   *
   * The schema stays whole and `username` is dropped from the *values*: the
   * column is `.optional()`, so an absent key decodes cleanly, while the empty
   * string does not. Omitting it from `groups` below is what hides the row —
   * `AutoForm` renders the fields its groups name and nothing else — and an
   * absent value is what keeps it out of the request.
   *
   * ⚠️ **`username` is never seeded as `""`, even when the field is shown.**
   * The old `?? ""` was not only a `"none"`-realm problem: `"optional"` is a
   * realm that collects usernames and does not insist, so an account without
   * one is the normal case there — and it crashed the page for exactly those
   * users while working for everyone who had set one. `undefined` is what an
   * empty optional field means, and it is what the two name fields would use
   * too if they were not `.nullable()` with a real "clear me" state.
   */
  const form = useForm({
    initialValues: {
      ...(hasUsername ? { username: props.profile?.username } : {}),
      firstName: props.profile?.firstName ?? "",
      lastName: props.profile?.lastName ?? "",
    },
    schema: updateMyProfileBodySchema,
    handler: async (values) => {
      try {
        setProfile(
          await api.updateMyProfile({
            body: {
              // Empty is "unset", which the API spells `null` — NOT
              // `undefined`, which means "leave this column alone" and made
              // clearing a name a silent no-op that still toasted success.
              firstName: values.firstName || null,
              lastName: values.lastName || null,
              // Absent, not `null`, in a realm without usernames: `null` is the
              // "clear this column" signal the two name fields use, and
              // `username` has no such state — absent is "leave it alone".
              username: values.username,
            },
          }),
        );
        toaster.show("Profile updated", "success");
      } catch (error: any) {
        // The username-taken 409 arrives here with its own message, which is
        // the only one worth showing. Toasted *and* rethrown: the toast is
        // what the user reads, and the throw is what keeps the form dirty and
        // errored so Save stays actionable for the retry.
        toaster.show(
          error?.message ?? "Could not update your profile",
          "danger",
        );
        throw error;
      }
    },
  });

  if (!profile) {
    return null;
  }

  const onPickAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      setProfile(await avatarApi.updateMyAvatar({ body: { file } }));
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
      setProfile(await avatarApi.deleteMyAvatar());
    } catch (error: any) {
      toaster.show(error?.message ?? "Could not remove your avatar", "danger");
    } finally {
      setUploading(false);
    }
  };

  // Realms opt into avatars (`features.avatars`, off by default), and an
  // unregistered action is absent from `/api/_links` — so this is the realm's
  // own switch read through the mechanism that cannot drift from it. Checking
  // a flag mirrored into the client instead would let the picker render
  // against endpoints that answer 404.
  const canEditAvatar = avatarApi.updateMyAvatar.can();

  return (
    <>
      {canEditAvatar && (
        <>
          <SettingsSection
            title="Profile picture"
            description="Shown next to your name wherever you appear."
          >
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
                  <div className="bg-muted size-full overflow-hidden rounded-full border">
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
                  <div className="bg-card absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full border">
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
        </>
      )}

      {/* The one section here whose rows are all form fields, so it is an
          `AutoForm` in row layout rather than hand-wired `SettingsRow`s — same
          card, same rows, same heading, plus schema validation, the error
          popover, Reset, and a Save that knows whether anything changed. The
          sections above and below stay hand-wired because their rows are an
          avatar picker and read-only values, not fields. */}
      <AutoForm
        form={form}
        layout="row"
        disabledIfPristine
        groups={[
          {
            title: "Name",
            description: "How you are identified to other people.",
            fields: hasUsername
              ? ["username", "firstName", "lastName"]
              : ["firstName", "lastName"],
          },
        ]}
        fields={{
          // Labels are explicit rather than derived: `prettyName` would title
          // -case them into "First Name", and this page's wording is settled.
          //
          // Icons are explicit because `Control`'s own fallback would resolve
          // the schema hint, and for a plain string that is the generic "T"
          // glyph — the same mark three times, saying "this is text" next to a
          // label that already said so. A field earns an icon by having one
          // that means something: `@` is what a handle looks like everywhere.
          username: {
            label: "Username",
            description: "Unique across this site.",
            autoComplete: "username",
            icon: AtSign,
            // No clear button: `updateMyProfile` has no "unset" for a
            // username, so the × would offer a deletion the server cannot
            // perform. First and last name keep theirs — those genuinely
            // clear, via `null`.
            clearable: false,
          },
          firstName: {
            label: "First name",
            autoComplete: "given-name",
            icon: User,
          },
          lastName: {
            label: "Last name",
            autoComplete: "family-name",
            icon: User,
          },
        }}
      />

      <SettingsSection
        title="Account"
        description="Details you cannot change from this page."
      >
        <SettingsRow
          label="Email"
          description="Changing your email needs verification, so it is not a profile edit."
        >
          <span className="text-muted-foreground text-sm">
            {profile.email ?? "Not set"}
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
