import { Badge } from "@alepha/ui/components/ui/badge";
import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Separator } from "@alepha/ui/components/ui/separator";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowRight, Globe2, ScrollText, Sparkles } from "lucide-react";
import type { AppRouter } from "../../AppRouter.ts";
import { userProjectsAtom } from "../../atoms/userProjectsAtom.ts";
import type { I18n } from "../../services/I18n.ts";
import RoadmapLogo from "../shared/RoadmapLogo.tsx";

type Project = {
  id: number;
  title: string;
  updatedAt: string;
  public?: boolean;
  packages: string[];
};

const Home = () => {
  const { tr } = useI18n<I18n, "en">();
  const [projects = []] = useStore(userProjectsAtom);
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
  const auth = useAuth();

  const sorted = [...projects].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );
  const createPath = router.path("projectCreate");

  return (
    <div className="bg-background flex flex-col">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
        <Hero
          createPath={createPath}
          welcomeTitle={String(tr("home.title"))}
          subtitle={String(tr("home.subtitle"))}
          createLabel={String(tr("home.create-campaign"))}
          adventurerName={auth.user?.username}
        />

        <Separator className="my-10" />

        <div id="campaigns" className="flex items-center gap-2">
          <ScrollText className="size-5" />
          <h2 className="text-lg font-semibold">{tr("home.campaigns")}</h2>
        </div>

        {sorted.length > 0 ? (
          <div className="mt-4 flex flex-col divide-y rounded-lg border">
            {sorted.map((project) => (
              <CampaignCard
                key={project.id}
                project={project}
                href={router.path("project", {
                  params: { projectId: project.id },
                })}
                relativeTime={dt.of(project.updatedAt).fromNow()}
              />
            ))}
          </div>
        ) : (
          <EmptyState createPath={createPath} />
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
  welcomeTitle: string;
  subtitle: string;
  createLabel: string;
  adventurerName?: string;
}

const Hero = (props: HeroProps) => {
  const greeting = props.adventurerName
    ? `Welcome back, ${props.adventurerName}`
    : props.welcomeTitle;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <RoadmapLogo size={28} className="size-7" />
        <span className="text-muted-foreground text-xs uppercase tracking-widest">
          Roadmap
        </span>
      </div>
      <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
        {greeting}
      </h1>
      <p className="text-muted-foreground max-w-xl text-base">
        {props.subtitle} Forge quests, recruit adventurers and chronicle your
        party's deeds across the realm.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild size="lg" className="h-12 px-12 text-base">
          <Link href={props.createPath}>
            <Sparkles className="size-5" />
            {props.createLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────────────────
 * Campaign row — single-line entry
 * ──────────────────────────────────────────────────────────────────────── */

interface CampaignCardProps {
  project: Project;
  href: string;
  relativeTime: string;
}

const CampaignCard = (props: CampaignCardProps) => {
  const zones = props.project.packages.length;
  return (
    <Link
      href={props.href}
      className="group hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
    >
      <span className="line-clamp-1 flex-1 truncate font-medium">
        {props.project.title}
      </span>
      <span className="text-muted-foreground hidden text-xs sm:inline">
        Updated {props.relativeTime}
        {zones > 0 && (
          <>
            {" · "}
            {zones} zone{zones === 1 ? "" : "s"}
          </>
        )}
      </span>
      {props.project.public && (
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Globe2 className="size-3" />
          Public
        </Badge>
      )}
      <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
};

/* ────────────────────────────────────────────────────────────────────────
 * Empty state
 * ──────────────────────────────────────────────────────────────────────── */

interface EmptyStateProps {
  createPath: string;
}

const EmptyState = (props: EmptyStateProps) => (
  <Card className="mt-4 border-dashed">
    <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="bg-muted text-muted-foreground inline-flex size-12 items-center justify-center rounded-full">
        <ScrollText className="size-5" />
      </div>
      <h3 className="text-base font-semibold">Your quest log is empty</h3>
      <p className="text-muted-foreground max-w-sm text-sm">
        Raise your banner and forge a campaign — every legend starts somewhere.
      </p>
      <Button asChild className="mt-2">
        <Link href={props.createPath}>
          <Sparkles className="size-4" />
          Start your first campaign
        </Link>
      </Button>
    </CardContent>
  </Card>
);
