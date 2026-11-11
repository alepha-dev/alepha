import { useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useEffect } from "react";

import type { HomeBoardResource } from "../../../../api/schemas/homeBoardSchema.ts";
import { realmSettingsAtom } from "../../atoms/realmSettingsAtom.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import HomeBoard from "./HomeBoard.tsx";
import HomeWelcome from "./HomeWelcome.tsx";

export interface HomeProps {
  /**
   * Deferred, and only for a signed-in visitor. The `home` loader catches its
   * failure, so it never reaches `errorHandler`.
   */
  board?: Promise<HomeBoardResource | undefined>;
}

const Home = (props: HomeProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userProjectsAtom);
  const [realmSettings] = useStore(realmSettingsAtom);
  const router = useRouter();
  const auth = useAuth();

  const projects = overview?.projects ?? [];
  const canCreate = overview?.canCreate ?? true;
  const maxProjects = overview?.maxProjects;
  const sorted = [...projects].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );
  const loginPath = router.path("login", {
    query: { redirect: router.path("home") },
  });
  // No explicit `r=` — `AuthRegisterPage` seeds it from the intent map so the
  // post-register flow lands on Home with `?action=createProject`, which then
  // pushes through to /new-project.
  const registerPath = router.path("register", {
    query: { intent: "createProject" },
  });
  // Filled by the `home` loader for an anonymous visitor; `true` for a
  // signed-in one, who never sees the hero.
  const registrationAllowed = realmSettings.registrationAllowed;
  // The hero's one button. Signed in it starts a project; signed out it used
  // to walk a stranger into the register page unconditionally, which is a
  // dead end the moment signups are closed: `@alepha/ui` renders
  // "Registration is not available" there and the visit ends.
  //
  // Closed, the button becomes Sign in, which is the thing a visitor can
  // actually do, and a line under it says why there is no signup. A blank
  // space where the call to action was reads as a broken page, so the closed
  // state is designed rather than merely absent.
  const createPath = auth.user
    ? router.path("projectCreate")
    : registrationAllowed
      ? registerPath
      : loginPath;

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

  // The signed-in landing page is the board; the hero is what an anonymous
  // visitor and a brand-new account still get. A table with no rows is a
  // worse first run than a welcome, and the hero is also the only place that
  // explains what this app is.
  if (hasProjects && props.board) {
    return <HomeBoard board={props.board} />;
  }

  return (
    <HomeWelcome
      cta={{
        createPath,
        // Dropped when the primary button IS sign in: two links to the same
        // page, one of them asking whether you are already registered, only
        // reads as a mistake.
        loginPath: auth.user || !registrationAllowed ? undefined : loginPath,
        createLabel:
          registrationAllowed || auth.user
            ? tr("home.start-first-project")
            : tr("home.sign-in"),
        note:
          registrationAllowed || auth.user
            ? undefined
            : tr("home.registration-closed"),
        createIcon: registrationAllowed || auth.user ? "create" : "signIn",
        alreadyRegistered: tr("home.already-registered"),
        createDisabled,
        createDisabledLabel:
          createDisabled && maxProjects
            ? tr("home.create-project.max", { args: [String(maxProjects)] })
            : undefined,
      }}
    />
  );
};

export default Home;
