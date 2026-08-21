import { Button } from "@alepha/ui/components/ui/button";
import { useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { Sparkles } from "lucide-react";
import { useEffect } from "react";

import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import Dashboard from "../dashboard/Dashboard.tsx";
import PageHeader from "../shared/header/PageHeader.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";

const Home = () => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userProjectsAtom);
  const router = useRouter<AppRouter>();
  const auth = useAuth();

  const projects = overview?.projects ?? [];
  const canCreate = overview?.canCreate ?? true;
  const maxProjects = overview?.maxProjects;
  const sorted = [...projects].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );
  const loginPath = router.path("login", {
    query: { r: router.path("home") },
  });
  // No explicit `r=` — `AuthRegisterPage` seeds it from the intent map so the
  // post-register flow lands on Home with `?action=createProject`, which then
  // pushes through to /new-project.
  const registerPath = router.path("register", {
    query: { intent: "createProject" },
  });
  const createPath = auth.user ? router.path("projectCreate") : registerPath;

  const hasProjects = !!auth.user && sorted.length > 0;
  const createDisabled = !!auth.user && !canCreate;

  useEffect(() => {
    const action =
      typeof router.query.action === "string" ? router.query.action : undefined;
    if (action !== "createProject") return;
    // Wait for auth to resolve before consuming the param. After register, the
    // redirect lands here with `?action=createProject` but `useAuth()` hasn't
    // synced yet — bail and let the next render retry with `auth.user` set.
    if (!auth.user || !canCreate) return;
    // Rewrite history from the route, not from `window.location` — during a
    // client-side transition the browser URL still holds the *previous* page,
    // so building on it would strip the param off the wrong address. Clearing
    // it matters because going Back would otherwise land on
    // `?action=createProject` and bounce forward again.
    window.history.replaceState(null, "", router.path("home"));
    void router.push("projectCreate");
  }, [router, auth.user, canCreate]);

  // The signed-in landing page is the dashboard; the hero is what an
  // anonymous visitor and a brand-new account still get. A dashboard of empty
  // tiles is a worse first run than a welcome, and the hero is also the only
  // place that explains what this app is.
  if (hasProjects) {
    return <Dashboard />;
  }

  return (
    <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-y-auto">
      <PageHeader showHome={false} />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
        <Hero
          createPath={createPath}
          loginPath={auth.user ? undefined : loginPath}
          welcomeTitle={tr("home.title")}
          subtitle={tr("home.subtitle")}
          createLabel={tr("home.start-first-project")}
          alreadyRegistered={tr("home.already-registered")}
          createDisabled={createDisabled}
          createDisabledLabel={
            createDisabled && maxProjects
              ? String(
                  tr("home.create-project.max", {
                    args: [String(maxProjects)],
                  }),
                )
              : undefined
          }
        />
      </div>
    </div>
  );
};

export default Home;

/* ────────────────────────────────────────────────────────────────────────
 * Hero
 * ──────────────────────────────────────────────────────────────────────── */

interface HeroProps {
  createPath: string;
  loginPath?: string;
  welcomeTitle: string;
  subtitle: string;
  createLabel: string;
  alreadyRegistered: string;
  createDisabled?: boolean;
  createDisabledLabel?: string;
}

const Hero = (props: HeroProps) => {
  const greeting = props.welcomeTitle;

  return (
    <div className="flex flex-col items-center gap-6 md:flex-row md:items-center md:gap-10">
      <div className="flex shrink-0 items-center justify-center p-4">
        <img
          src="/lore-start.webp"
          alt="Lore"
          className="size-48 object-contain md:size-56 dark:hidden"
        />
        <img
          src="/lore-start-light.webp"
          alt="Lore"
          className="hidden size-48 object-contain md:size-56 dark:block"
        />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <LoreLogo size={28} className="animate-floating size-7" />
          <span className="text-muted-foreground text-xs tracking-widest uppercase">
            Alepha Lore
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          {greeting}
        </h1>
        <p className="text-muted-foreground max-w-xl text-base">
          {props.subtitle}
        </p>
        <div className="mt-2 flex flex-col items-start gap-2">
          {props.createDisabled ? (
            <Button size="lg" disabled className="h-12 px-12 text-base">
              <Sparkles className="size-5" />
              {props.createLabel}
            </Button>
          ) : (
            <Button
              render={<Link href={props.createPath} />}
              // A link wearing a button's clothes: `nativeButton={false}` stops Base UI
              // assuming a native <button> (it warns otherwise), and `role` puts back the
              // link semantics its non-native branch would overwrite with `role="button"`.
              nativeButton={false}
              role="link"
              size="lg"
              className="h-12 px-12 text-base"
            >
              <Sparkles className="size-5" />
              {props.createLabel}
            </Button>
          )}
          {props.createDisabled && props.createDisabledLabel && (
            <span className="text-muted-foreground text-xs">
              {props.createDisabledLabel}
            </span>
          )}
          {props.loginPath && (
            <Link
              href={props.loginPath}
              className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
            >
              {props.alreadyRegistered}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
