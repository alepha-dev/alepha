import { useI18n } from "alepha/react/i18n";
import { Bot, Server, Workflow } from "lucide-react";

import type { I18n } from "../../services/I18n.ts";
import LoreLogoAnimated from "../shared/LoreLogoAnimated.tsx";
import HomeWelcomeCta, { type HomeWelcomeCtaProps } from "./HomeWelcomeCta.tsx";
import HomeWelcomeFeature from "./HomeWelcomeFeature.tsx";
import HomeWelcomeHeader from "./HomeWelcomeHeader.tsx";
import HomeWelcomePillar from "./HomeWelcomePillar.tsx";

export interface HomeWelcomeProps {
  cta: Omit<HomeWelcomeCtaProps, "block">;
}

/**
 * What a visitor with no project sees on Home: the signed-out stranger and
 * the brand-new account. It is the only page that says what Lore is, so it
 * says it as three pillars, Plan, Remember and Ship, and never in the
 * internal vocabulary (no "quest" here).
 *
 * It is ruled like the board (`HomeBoard`): two rails down the full height
 * at the gutters, a line under the header and one above the footer. The
 * pillars are a band ruled rail to rail; under them, a thinner band of three
 * small features that are not modules (agents, automations, self-hosting),
 * each linking to its guide; and the column lines run on down to the footer. On a phone the pillars stack and the button moves to a bar
 * pinned to the bottom of the screen.
 */
const HomeWelcome = (props: HomeWelcomeProps) => {
  const { tr } = useI18n<I18n, "en">();

  return (
    <div className="relative flex h-svh flex-col">
      <div
        aria-hidden
        className="bg-border pointer-events-none absolute inset-y-0 left-4 z-20 w-px"
      />
      <div
        aria-hidden
        className="bg-border pointer-events-none absolute inset-y-0 right-4 z-20 w-px"
      />
      <HomeWelcomeHeader />
      <main className="lore-page-dots bg-background mx-4 flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-4 px-4 pt-10 pb-10 text-center md:flex-row md:gap-12 md:px-8 md:pt-16 md:pb-14 md:text-left">
          <LoreLogoAnimated follow className="size-36 shrink-0 md:size-60" />
          <div className="flex flex-col items-center gap-4 md:items-start">
            <h1 className="text-2xl font-semibold tracking-tight md:text-4xl">
              {tr("home.welcome.title")}
            </h1>
            <p className="text-muted-foreground max-w-xl text-base md:text-lg">
              {tr("home.welcome.subtitle")}
            </p>
            <div className="mt-2 hidden md:block">
              <HomeWelcomeCta {...props.cta} />
            </div>
          </div>
        </div>
        {/*
          The band: a rule above and below it from rail to rail, and the
          three cells between column rules.
        */}
        <div className="shrink-0 border-y">
          <div className="divide-border mx-auto grid max-w-5xl divide-y border-x md:grid-cols-3 md:divide-x md:divide-y-0">
            <HomeWelcomePillar
              pillar="plan"
              title={tr("home.pillar.plan.title")}
              description={tr("home.pillar.plan.description")}
            />
            <HomeWelcomePillar
              pillar="remember"
              title={tr("home.pillar.remember.title")}
              description={tr("home.pillar.remember.description")}
            />
            <HomeWelcomePillar
              pillar="ship"
              title={tr("home.pillar.ship.title")}
              description={tr("home.pillar.ship.description")}
            />
          </div>
        </div>
        <div className="shrink-0 border-b">
          <div className="divide-border mx-auto grid max-w-5xl divide-y border-x md:grid-cols-3 md:divide-x md:divide-y-0">
            <HomeWelcomeFeature
              icon={Bot}
              title={tr("home.feature.agents.title")}
              description={tr("home.feature.agents.description")}
              href={`${HomeWelcome.docs}/docs/agents-connecting`}
            />
            <HomeWelcomeFeature
              icon={Workflow}
              title={tr("home.feature.automations.title")}
              description={tr("home.feature.automations.description")}
              href={`${HomeWelcome.docs}/docs/work-automations`}
            />
            <HomeWelcomeFeature
              icon={Server}
              title={tr("home.feature.selfHost.title")}
              description={tr("home.feature.selfHost.description")}
              href={`${HomeWelcome.docs}/docs/start-self-hosting`}
            />
          </div>
        </div>
        {/*
          The column rules carried on below the band to the footer, from
          `md` up. On a phone this is the room the pinned button needs.
        */}
        <div
          aria-hidden
          className="divide-border mx-auto grid min-h-44 w-full max-w-5xl flex-1 md:min-h-16 md:grid-cols-3 md:divide-x md:border-x"
        >
          <div />
          <div className="max-md:hidden" />
          <div className="max-md:hidden" />
        </div>
      </main>
      <footer className="h-4 shrink-0 border-t" />
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-40 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
        <HomeWelcomeCta {...props.cta} block />
      </div>
    </div>
  );
};

/**
 * Lore's documentation site.
 */
HomeWelcome.docs = "https://alepha.dev/lore";

export default HomeWelcome;
