import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Link, useRouter } from "alepha/react/router";
import { KeyRound, Link2, Server } from "lucide-react";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentInstanceAtom } from "../../../atoms/currentInstanceAtom.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * What an instance with nothing unlocked offers instead of an empty card grid.
 *
 * This is the normal state right after creation, and it is where you land, so
 * it is the first impression of the whole feature. Three steps, each a link to
 * the row on Settings that performs it: mint the key telemetry reports with,
 * pin the address, choose a deploy target.
 *
 * None of them is required. An instance with none of the three is a deployed
 * copy Lore knows about and nothing more, which is a legitimate thing to want:
 * the page says what each step buys rather than reading as a checklist to
 * clear.
 *
 * ⚠️ Every step lands on the same tab, so the links carry no anchor. Anchors
 * into a settings page are a promise the page has to keep as it is reordered,
 * and this one is short enough not to need one.
 */
const AppDashboardNextSteps = () => {
  const { tr } = useI18n<I18n, "en">();
  const router = useRouter<AppRouter>();

  const [project] = useStore(currentProjectAtom);
  const [instance] = useStore(currentInstanceAtom);

  if (!project || !instance) {
    return null;
  }

  const settingsHref = router.path("appSettings", {
    params: {
      projectSlug: project.slug,
      app: instance.app,
      env: instance.env,
    },
  });

  const steps = [
    {
      key: "sigil",
      icon: KeyRound,
      title: tr("app.nextSteps.sigil.title"),
      description: tr("app.nextSteps.sigil.description"),
      done: Boolean(instance.sigil),
    },
    {
      key: "url",
      icon: Link2,
      title: tr("app.nextSteps.url.title"),
      description: tr("app.nextSteps.url.description"),
      done: Boolean(instance.url),
    },
    {
      key: "estate",
      icon: Server,
      title: tr("app.nextSteps.estate.title"),
      description: tr("app.nextSteps.estate.description"),
      done: Boolean(instance.estateId),
    },
  ];

  return (
    <Card data-testid="app-next-steps">
      <CardHeader>
        <CardTitle className="text-base">{tr("app.nextSteps.title")}</CardTitle>
        <CardDescription>{tr("app.nextSteps.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {steps.map((step) => (
          <Link
            key={step.key}
            href={settingsHref}
            className="hover:bg-muted/60 -mx-2 flex items-start gap-3 rounded-md px-2 py-2 transition-colors"
          >
            <step.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{step.title}</span>
              <span className="text-muted-foreground text-xs">
                {step.done ? tr("app.nextSteps.done") : step.description}
              </span>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
};

export default AppDashboardNextSteps;
