import { Button } from "@alepha/ui/components/ui/button";
import { Card, CardContent } from "@alepha/ui/components/ui/card";
import { Separator } from "@alepha/ui/components/ui/separator";
import { DateTimeProvider } from "alepha/datetime";
import { useInject, useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { ArrowRight, ScrollText, Sparkles } from "lucide-react";
import { useEffect } from "react";
import type { AppRouter } from "../../AppRouter.ts";
import { userCampaignsAtom } from "../../atoms/userCampaignsAtom.ts";
import { displayName } from "../../services/displayName.ts";
import type { I18n } from "../../services/I18n.ts";
import { CampaignIcon } from "../shared/CampaignIcon.tsx";
import PageHeader from "../shared/header/PageHeader.tsx";
import LoreLogo from "../shared/LoreLogo.tsx";

type Campaign = {
  id: number;
  title: string;
  updatedAt: string;
  public?: boolean;
  zones: string[];
  icon?: string;
};

const Home = () => {
  const { tr } = useI18n<I18n, "en">();
  const [overview] = useStore(userCampaignsAtom);
  const router = useRouter<AppRouter>();
  const dt = useInject(DateTimeProvider);
  const auth = useAuth();

  const campaigns = overview?.campaigns ?? [];
  const canCreate = overview?.canCreate ?? true;
  const maxCampaigns = overview?.maxCampaigns;
  const sorted = [...campaigns].sort((a, b) =>
    a.updatedAt > b.updatedAt ? -1 : 1,
  );
  const loginPath = router.path("login", {
    query: { r: router.path("home") },
  });
  // No explicit `r=` — `AuthRegisterPage` seeds it from the intent map so the
  // post-register flow lands on Home with `?action=createCampaign`, which then
  // pushes through to /new-campaign.
  const registerPath = router.path("register", {
    query: { intent: "createCampaign" },
  });
  const createPath = auth.user ? router.path("campaignCreate") : registerPath;

  const hasCampaigns = !!auth.user && sorted.length > 0;
  const userName =
    auth.user && hasCampaigns
      ? displayName(auth.user, "") || undefined
      : undefined;
  const createLabel = hasCampaigns
    ? tr("home.create-campaign")
    : tr("home.start-first-campaign");
  const createDisabled = !!auth.user && !canCreate;

  useEffect(() => {
    const action =
      typeof router.query.action === "string" ? router.query.action : undefined;
    if (action !== "createCampaign") return;
    // Wait for auth to resolve before consuming the param. After register, the
    // redirect lands here with `?action=createCampaign` but `useAuth()` hasn't
    // synced yet — bail and let the next render retry with `auth.user` set.
    if (!auth.user || !canCreate) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("action");
    window.history.replaceState(null, "", url.toString());
    router.push("campaignCreate");
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
            createDisabled && maxCampaigns
              ? String(
                  tr("home.create-campaign.max", {
                    args: [String(maxCampaigns)],
                  }),
                )
              : undefined
          }
        />

        {hasCampaigns && (
          <>
            <Separator className="my-10" />

            <div id="campaigns" className="flex items-center gap-2">
              <ScrollText className="size-5" />
              <h2 className="text-lg font-semibold">{tr("home.campaigns")}</h2>
            </div>

            <Card className="mt-4 p-0">
              <CardContent className="flex flex-col divide-y p-0">
                {sorted.map((campaign) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    href={router.path("campaign", {
                      params: { campaignId: campaign.id },
                    })}
                    relativeTime={dt.of(campaign.updatedAt).fromNow()}
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
 * Campaign row — single-line entry
 * ──────────────────────────────────────────────────────────────────────── */

interface CampaignCardProps {
  campaign: Campaign;
  href: string;
  relativeTime: string;
}

const CampaignCard = (props: CampaignCardProps) => {
  const zones = props.campaign.zones.length;
  return (
    <Link
      href={props.href}
      className="group hover:bg-muted/50 flex items-center gap-3 rounded-md px-2 py-2 text-sm transition-colors"
    >
      <CampaignIcon fileId={props.campaign.icon} className="size-8" />
      <span className="line-clamp-1 flex-1 truncate font-medium">
        {props.campaign.title}
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
      <ArrowRight className="text-muted-foreground size-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
};
