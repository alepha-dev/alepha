import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Separator } from "@alepha/ui/components/ui/separator";
import { DateTimeProvider } from "alepha/datetime";
import { ClientOnly, useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowRight, ScrollText, Sparkles } from "lucide-react";
import { useEffect } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";
import PageHeader from "../shared/header/PageHeader.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";
import { ProjectIcon } from "../shared/ProjectIcon.tsx";

type Project = {
  id: number;
  title: string;
  updatedAt: string;
  public?: boolean;
  zones: string[];
  icon?: string;
};

const Home = () => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userProjectsAtom);
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
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
  const userName =
    auth.user && hasProjects
      ? displayName(auth.user, "") || undefined
      : undefined;
  const createLabel = hasProjects
    ? tr("home.create-project")
    : tr("home.start-first-project");
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
    router.push("projectCreate");
  }, [router, auth.user, canCreate]);

  return (
    <div className="relative flex h-screen w-full flex-col items-center justify-center overflow-y-auto">
      <PageHeader showHome={false} />
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
        <Hero
          createPath={createPath}
          loginPath={auth.user ? undefined : loginPath}
          welcomeTitle={tr("home.title")}
          subtitle={tr("home.subtitle")}
          createLabel={createLabel}
          alreadyRegistered={tr("home.already-registered")}
          userName={userName}
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

        {hasProjects && (
          <>
            <Separator className="my-10" />

            <div id="projects" className="flex items-center gap-2">
              <ScrollText className="size-5" />
              <h2 className="text-lg font-semibold">{tr("home.projects")}</h2>
            </div>

            <Card className="mt-4 p-0">
              <CardContent className="flex flex-col divide-y p-0">
                {sorted.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    href={router.path("project", {
                      params: { projectId: project.id },
                    })}
                    relativeTime={dt.of(project.updatedAt).fromNow()}
                  />
                ))}
              </CardContent>
            </Card>
          </>
        )}
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
  userName?: string;
  createDisabled?: boolean;
  createDisabledLabel?: string;
}

const Hero = (props: HeroProps) => {
  const greeting = props.userName
    ? `Welcome back, ${props.userName}`
    : props.welcomeTitle;

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
          <LoreLogo size={28} className="size-7 animate-floating" />
          <span className="text-muted-foreground text-xs uppercase tracking-widest">
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

/* ────────────────────────────────────────────────────────────────────────
 * Project row — single-line entry
 * ──────────────────────────────────────────────────────────────────────── */

interface ProjectCardProps {
  project: Project;
  href: string;
  relativeTime: string;
}

const ProjectCard = (props: ProjectCardProps) => {
  const zones = props.project.zones.length;
  return (
    <Link
      href={props.href}
      className="group hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
    >
      <ProjectIcon fileId={props.project.icon} className="size-8" />
      <span className="line-clamp-1 flex-1 truncate font-medium">
        {props.project.title}
      </span>
      <span className="text-muted-foreground hidden text-xs sm:inline">
        {/* Home is the only SSR'd route. `fromNow()` is relative-to-now, so it
            mismatches between the server render and client hydration (clock
            drift / unit boundary) → React #418. Render it client-only. */}
        Updated <ClientOnly>{props.relativeTime}</ClientOnly>
        {zones > 0 && (
          <>
            {" · "}
            {zones} zone{zones === 1 ? "" : "s"}
          </>
        )}
      </span>
      <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
};
