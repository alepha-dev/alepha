import { AuthRegister } from "@alepha/ui/components/auth/auth-register";
import type { RealmConfig } from "alepha/api/users";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import type { I18n } from "../../services/I18n.ts";
import PageHeader from "../shared/header/PageHeader.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";
import { resolveRegisterIntent } from "./registerIntents.ts";

export interface AuthRegisterPageProps {
  realmConfig: RealmConfig;
}

const AuthRegisterPage = (props: AuthRegisterPageProps) => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();
  const intentKey =
    typeof router.query.intent === "string" ? router.query.intent : undefined;
  const entry = resolveRegisterIntent(intentKey);

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
          redirect: entry.redirectTo,
        },
      })
      .catch(() => undefined);
  }, [entry, intentKey, router]);

  const message = entry ? tr(entry.messageKey as any) : undefined;

  return (
    <>
      <PageHeader />
      <AuthRegister
        realmConfig={props.realmConfig}
        message={message}
        logo={<LoreLogo size={64} className="size-16 animate-floating" />}
      />
    </>
  );
};

export default AuthRegisterPage;
