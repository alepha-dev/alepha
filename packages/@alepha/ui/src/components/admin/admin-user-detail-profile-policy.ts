import type {
  FieldRequirement,
  UpdateUser,
  UsernameFieldRequirement,
} from "alepha/api/users";
import type { ProfileForm } from "./admin-user-detail-profile-schema.ts";

/**
 * The realm settings the admin profile form cares about. A structural subset
 * of the realm config's public settings, so `realmConfig.settings` can be
 * passed straight in.
 */
export interface ProfileRealmSettings {
  username?: UsernameFieldRequirement;
  email?: FieldRequirement;
}

export interface ProfileFieldPolicy {
  visible: boolean;
  required: boolean;
}

export interface ProfilePolicy {
  username: ProfileFieldPolicy;
  email: ProfileFieldPolicy;
}

/**
 * The parts of the loaded user the policy reads: what the record already
 * carries, as opposed to what the form currently holds.
 */
export interface ProfileUser {
  username?: string;
  email?: string;
}

export type ProfileIssueReason = "required" | "cannot-clear";

export interface ProfileIssue {
  field: "username" | "email";
  reason: ProfileIssueReason;
}

/**
 * Whether a single field is offered, and whether it must be filled.
 */
const fieldPolicy = (
  requirement: UsernameFieldRequirement | undefined,
  current: string | undefined,
): ProfileFieldPolicy => {
  // No settings means the realm config could not be read. Inventing a
  // requirement the realm may not have is what broke this form for
  // username-only realms in the first place — and nothing server-side
  // requires either field, so "optional" is both the safe default and the
  // accurate one.
  const req = requirement ?? "optional";
  return {
    // A realm that has stopped collecting a field can still have rows that
    // carry one. Hide the input only when there is also nothing to show.
    visible: req !== "none" || Boolean(current),
    // `"email"` (username auto-derived from the email at signup) is not a
    // requirement an admin has to satisfy by hand.
    required: req === "required",
  };
};

/**
 * Derive which profile fields the admin form offers, and which of them the
 * realm insists on.
 *
 * The form itself must not decide this: a realm configured for username-only
 * sign-in (`email: "none"`) has users with no email at all, and demanding one
 * makes every save fail — including a save that only touches roles.
 */
export const profilePolicy = (
  settings?: ProfileRealmSettings,
  user?: ProfileUser,
): ProfilePolicy => ({
  username: fieldPolicy(settings?.username, user?.username),
  email: fieldPolicy(settings?.email, user?.email),
});

/**
 * Validate the submitted values against the realm policy. Returns every
 * problem found; callers typically report the first.
 */
export const profileIssues = (
  values: ProfileForm,
  policy: ProfilePolicy,
  user?: ProfileUser,
): ProfileIssue[] => {
  const issues: ProfileIssue[] = [];
  for (const field of ["username", "email"] as const) {
    if (!policy[field].visible) continue;
    if ((values[field] ?? "").trim()) continue;
    if (policy[field].required) {
      issues.push({ field, reason: "required" });
      continue;
    }
    // Blanking a field that has a value is not a no-op the user should be
    // left guessing about. `username` and `email` are both unique-indexed,
    // so a blank cannot be written as `""` — the second user to try it
    // collides with the first — and a partial PATCH has no way to spell
    // "unset". Refuse it rather than drop the key and report success on a
    // save that changed nothing.
    if ((user?.[field] ?? "") !== "") {
      issues.push({ field, reason: "cannot-clear" });
    }
  }
  return issues;
};

/**
 * Build the PATCH body from the form values.
 *
 * Fields the realm does not collect — and blank optional ones — are omitted
 * entirely rather than sent as `""`: `users` is uniquely indexed on
 * `(realm, username)` and `(realm, email)`, so an empty string is a value
 * that collides, not an absence.
 */
export const profileUpdateBody = (
  values: ProfileForm,
  policy: ProfilePolicy,
  user?: ProfileUser,
): UpdateUser => {
  const body: UpdateUser = {
    firstName: (values.firstName ?? "").trim(),
    lastName: (values.lastName ?? "").trim(),
    roles: values.roles ?? [],
  };

  const username = (values.username ?? "").trim();
  if (policy.username.visible && username) {
    body.username = username;
  }

  const email = (values.email ?? "").trim();
  if (policy.email.visible && email) {
    body.email = email;
    // Changing the email invalidates the verified flag. The server enforces
    // this as well; mirroring it keeps the UI consistent before the refetch.
    body.emailVerified =
      email === (user?.email ?? "") && Boolean(values.emailVerified);
  }

  return body;
};
