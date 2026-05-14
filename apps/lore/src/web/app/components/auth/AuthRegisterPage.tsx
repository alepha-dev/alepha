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
    if (router.query.r) return;
    const url = new URL(window.location.href);
    url.searchParams.set("r", entry.redirectTo);
    // `router.push` with `replace: true` updates both the URL and the router's
    // own query state, so `router.query.r` reads the seeded value on the
    // re-render. `history.replaceState` alone leaves `router.query` stale.
    router
      .push(url.pathname + url.search, { replace: true })
      .catch(() => undefined);
  }, [entry, router]);

  const message = entry ? String(tr(entry.messageKey as any)) : undefined;

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
