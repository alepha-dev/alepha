import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect } from "react";

import type { InvitationTokenPreview } from "@/api/schemas/invitationTokenPreviewSchema.ts";

import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import PageHeader from "../shared/header/PageHeader.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";
import AuthRegisterInvitationNotice from "./AuthRegisterInvitationNotice.tsx";
import { resolveRegisterIntent } from "./registerIntents.ts";

export interface AuthRegisterPageProps {
  realmConfig: RealmConfig;
  /**
   * What the `?invitation=` token turned out to be, resolved in the route
   * loader so this page never renders the wrong thing first. Absent when
   * there was no token, or when the lookup failed.
   */
  invitation?: InvitationTokenPreview;
  /**
   * The raw token, forwarded to the register request as its
   * pre-authorization proof.
   */
  invitationToken?: string;
}

/**
 * Where the invite mail lands.
 *
 * The page has three shapes, and which one it takes is decided before the
 * first paint by the loader:
 *
 * - no token, or a token that resolved to `ok`: the ordinary register form,
 *   with the address pre-filled and locked when there is one;
 * - `accountExists` and the four dead ends: a notice with its own sentence
 *   and a way to sign in;
 * - nothing else changes for a visitor arriving without a token at all.
 *
 * Success lands on the invitations inbox rather than auto-joining. That is
 * the deliberate half of the design: joining a project is worth a click, the
 * inbox is reachable identically after a credentials submit and after an
 * OAuth round trip (which carries no token home), and an interrupted flow
 * leaves the invitation exactly where it was instead of half-applied.
 */
const AuthRegisterPage = (props: AuthRegisterPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const intentKey =
    typeof router.query.intent === "string" ? router.query.intent : undefined;
  const entry = resolveRegisterIntent(intentKey);
  const invitation = props.invitation;
  const invited = invitation?.status === "ok";

  // Where a successful registration lands. An invited visitor goes to their
  // invitations inbox, which is the same destination on both paths: the
  // credentials submit pushes there, and an OAuth round trip (which carries
  // no token home) hands the same value to the provider flow.
  //
  // Passed as a PROP rather than seeded into `?redirect=` like the intent
  // below, because `AuthRegister` builds its submit handler once at mount:
  // a query param written by an effect arrives too late and the person lands
  // on the default with nothing to say why.
  const invitedRedirect = invited
    ? router.path("accountInvitations")
    : undefined;

  useEffect(() => {
    if (!entry) return;
    if (router.query.redirect) return;
    // Target the route by name and let the router build the URL.
    //
    // This used to read `window.location.href`, which is correct on a direct
    // load and wrong on every client-side navigation: the router renders the
    // new page first and only writes history afterwards, so an effect firing
    // during the transition still sees the *previous* page's URL. Arriving
    // from Home therefore rebuilt the address as `/?redirect=…` and bounced
    // straight back to Home — the CTA looked like a dead link.
    //
    // `router.push` with `replace: true` updates both the URL and the router's
    // own query state, so `router.query.redirect` reads the seeded value on the
    // re-render. `history.replaceState` alone leaves `router.query` stale.
    router
      .push("register", {
        replace: true,
        query: {
          ...(intentKey ? { intent: intentKey } : {}),
          ...(typeof router.query.invitation === "string"
            ? { invitation: router.query.invitation }
            : {}),
          redirect: entry.redirectTo,
        },
      })
      .catch(() => undefined);
  }, [entry, intentKey, router]);

  const loginPath = router.path("login", {
    query: { redirect: router.path("accountInvitations") },
  });

  if (invitation && invitation.status !== "ok") {
    return (
      <>
        <PageHeader />
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <AuthRegisterInvitationNotice
            status={invitation.status}
            loginPath={loginPath}
          />
        </div>
      </>
    );
  }

  const message = invited
    ? tr("auth.register.intent.invitation", {
        args: [invitation?.projectTitle ?? ""],
      })
    : entry
      ? tr(entry.messageKey as keyof I18n)
      : undefined;

  return (
    <>
      <PageHeader />
      <AuthRegister
        realmConfig={props.realmConfig}
        message={message}
        logo={<LoreLogo size={64} className="animate-floating size-16" />}
        // The realm may well be closed; the token is what says this one
        // address may pass. The server checks it again through
        // `isPreAuthorized`, so rendering the form is presentation only.
        preAuthorized={invited}
        lockedEmail={invited ? invitation?.email : undefined}
        preAuthToken={invited ? props.invitationToken : undefined}
        redirect={invitedRedirect}
      />
    </>
  );
};

export default AuthRegisterPage;
