import type {
  MyAvatarController,
  MyProfile,
  MyProfileController,
  RealmConfig,
} from "alepha/api/users";
import { updateMyProfileBodySchema } from "alepha/api/users";
import { useAction, useClient } from "alepha/react";
import { useActionForm } from "alepha/react/form";
import { useI18n } from "alepha/react/i18n";
import { AtSign, Camera, Trash2, User } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";

import { Badge } from "../core/Badge.tsx";
import { Button } from "../core/Button.tsx";
import { FileImage } from "../core/FileImage.tsx";
import { useToast } from "../core/useToast.tsx";
import { AutoForm } from "../form/AutoForm.tsx";
import { SettingsRow } from "../settings/SettingsRow.tsx";
import { SettingsSection } from "../settings/SettingsSection.tsx";
import { AccountDisplay } from "./AccountDisplay.tsx";
import { AccountPage } from "./AccountPage.tsx";
import type { AccountProfileProps } from "./AccountProfile.tsx";

export interface AccountProfileViewProps extends AccountProfileProps {
  profile: MyProfile;

  /**
   * Read for one thing: whether this realm collects usernames at all.
   * Absent, the username field renders, the right guess for a realm nobody
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
export const AccountProfileView = (props: AccountProfileViewProps) => {
  const api = useClient<MyProfileController>();
  const avatarApi = useClient<MyAvatarController>();
  const toaster = useToast();
  const { l, tr } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<MyProfile | undefined>(props.profile);
  // A refused image (too large, a type the realm does not take) is toasted
  // by the app's ActionErrorToaster with the server's message.
  const uploadAvatar = useAction<[file: File]>(
    {
      handler: async (_ctx, file) => {
        setProfile(await avatarApi.updateMyAvatar({ body: { file } }));
        toaster.show(
          tr("account.profile.avatarUpdated", { default: "Avatar updated" }),
          "success",
        );
      },
    },
    [avatarApi, toaster, tr],
  );
  const removeAvatar = useAction<[]>(
    {
      handler: async () => {
        setProfile(await avatarApi.deleteMyAvatar());
      },
    },
    [avatarApi],
  );
  const uploading = uploadAvatar.loading || removeAvatar.loading;

  /*
   * Does this realm have usernames at all?
   *
   * The avatar section above reads its switch through `can()`, because a realm
   * with `features.avatars` off registers no avatar action and the capability
   * is simply absent from `/api/_links`. That cannot work here:
   * `updateMyProfile` is the same call that saves first and last name, so it
   * exists in every realm and its presence says nothing about usernames.
   *
   * The realm's own `settings.username` is the switch, and the row is hidden
   * in the two modes where a person does not choose a username, the same rule
   * `AuthRegister.tsx` applies:
   *
   * - `"none"`: the realm has no such thing as a username, so there is nothing
   *   to show and nothing the user could set. Without this, `?? ""` seeded an
   *   empty string into a column that is `.optional()` but `minLength: 3`,
   *   `FormModel` decodes its initial values on construction, and the whole
   *   page died at `useForm` with "Too small: expected string to have >=3
   *   characters at /username" before anything rendered. `apps/examples/shop`
   *   is such a realm, and `"none"` is also the framework default.
   * - `"email"`: `RegistrationService` derives the handle from the address and
   *   the person never chose it. Showing it as an editable row (it once did,
   *   for Lore's sake) offered a rename that desyncs it from the email that
   *   produced it, since `updateMyProfile` does not re-run the slugger, and
   *   apps in that mode read the row as a stray field. Hidden, it is
   *   also left out of the request, so the derived handle stays as it is.
   */
  const usernameMode = props.realmConfig?.settings?.username;
  const hasUsername = usernameMode !== "none" && usernameMode !== "email";

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
   *
   * Built from the action (`useActionForm`): the values are the body as they
   * are. An emptied name box sends `""`, which `updateMyProfile` stores as
   * "no name" itself (it used to be mapped to `null` here, #Q3225), and an
   * absent `username` stays "leave it alone".
   */
  const form = useActionForm(api.updateMyProfile, {
    initialValues: {
      ...(hasUsername ? { username: props.profile?.username } : {}),
      firstName: props.profile?.firstName ?? "",
      lastName: props.profile?.lastName ?? "",
    },
    schema: updateMyProfileBodySchema,
    onSuccess: (updated) => {
      setProfile(updated);
      toaster.show(
        tr("account.profile.updated", { default: "Profile updated" }),
        "success",
      );
      // No catch. A refusal (the username-taken 409, with its own message)
      // propagates: that keeps the form dirty and errored so Save stays
      // actionable, and `ActionErrorToaster` shows the message once. It used
      // to be toasted here too, which put it on screen twice wherever that
      // listener is mounted. Same division of labour as the auth forms and
      // `AdminUserDetail`: the handler throws, the toaster shows.
    },
  });

  if (!profile) {
    return null;
  }

  const onPickAvatar = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared at once, so picking the same file again still fires a change.
    event.target.value = "";
    if (!file) {
      return;
    }
    void uploadAvatar.run(file);
  };

  // Realms opt into avatars (`features.avatars`, off by default), and an
  // unregistered action is absent from `/api/_links` — so this is the realm's
  // own switch read through the mechanism that cannot drift from it. Checking
  // a flag mirrored into the client instead would let the picker render
  // against endpoints that answer 404.
  const canEditAvatar = avatarApi.updateMyAvatar.can();

  return (
    <AccountPage variant="form" className={props.className}>
      {canEditAvatar && (
        <>
          <SettingsSection
            title={tr("account.profile.pictureTitle", {
              default: "Profile picture",
            })}
            description={tr("account.profile.pictureDescription", {
              default: "Shown next to your name wherever you appear.",
            })}
          >
            <SettingsRow
              label={tr("account.profile.avatar", { default: "Avatar" })}
              description={tr("account.profile.avatarDescription", {
                default: "PNG, JPEG, GIF or WebP, up to 5 MB.",
              })}
            >
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading}
                  aria-label={tr("account.profile.avatarChange", {
                    default: "Change avatar",
                  })}
                  className="relative size-14 shrink-0"
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
                    variant="minimal"
                    size="sm"
                    onClick={() => removeAvatar.run()}
                    disabled={uploading}
                  >
                    <Trash2 className="size-4" />
                    {tr("account.profile.avatarRemove", { default: "Remove" })}
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
            title: tr("account.profile.nameTitle", { default: "Name" }),
            description: tr("account.profile.nameDescription", {
              default: "How you are identified to other people.",
            }),
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
            label: tr("account.profile.username", { default: "Username" }),
            description: tr("account.profile.usernameDescription", {
              default: "Unique across this site.",
            }),
            autoComplete: "username",
            icon: AtSign,
            // No clear button: `updateMyProfile` has no "unset" for a
            // username, so the × would offer a deletion the server cannot
            // perform. First and last name keep theirs — those genuinely
            // clear, via `null`.
            clearable: false,
          },
          firstName: {
            label: tr("account.profile.firstName", { default: "First name" }),
            autoComplete: "given-name",
            icon: User,
          },
          lastName: {
            label: tr("account.profile.lastName", { default: "Last name" }),
            autoComplete: "family-name",
            icon: User,
          },
        }}
      />

      <SettingsSection
        title={tr("account.profile.accountTitle", { default: "Account" })}
        description={tr("account.profile.accountDescription", {
          default: "Details you cannot change from this page.",
        })}
      >
        <SettingsRow
          label={tr("account.profile.email", { default: "Email" })}
          description={tr("account.profile.emailDescription", {
            default:
              "Changing your email needs verification, so it is not a profile edit.",
          })}
        >
          <span className="text-muted-foreground text-sm">
            {profile.email ??
              tr("account.profile.emailUnset", { default: "Not set" })}
          </span>
        </SettingsRow>
        <SettingsRow label={tr("account.profile.roles", { default: "Roles" })}>
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
        <SettingsRow
          label={tr("account.profile.memberSince", { default: "Member since" })}
        >
          <span className="text-muted-foreground text-sm">
            {l(profile.createdAt, { date: "LL" })}
          </span>
        </SettingsRow>
      </SettingsSection>

      <AccountDisplay />
    </AccountPage>
  );
};
