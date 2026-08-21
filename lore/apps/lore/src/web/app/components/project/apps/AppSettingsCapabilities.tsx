import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@alepha/ui/components/ui/card";
import { Switch } from "@alepha/ui/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useClient, useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import { useState } from "react";

import type { SigilController } from "@/api/controllers/SigilController.ts";

import type { AppRouter } from "../../../AppRouter.ts";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { currentProjectMemberAtom } from "../../../atoms/currentProjectMemberAtom.ts";
import { currentSigilAtom } from "../../../atoms/currentSigilAtom.ts";
import { currentSigilsAtom } from "../../../atoms/currentSigilsAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

type CapabilityKey = "feedback" | "blights" | "beacon" | "vitals";

interface CapabilityRow {
  key: CapabilityKey;
  titleKey:
    | "feedback.feature.title"
    | "blights.feature.title"
    | "beacon.feature.title"
    | "vitals.feature.title";
  descriptionKey:
    | "feedback.feature.description"
    | "blights.feature.description"
    | "beacon.feature.description"
    | "vitals.feature.description";
}

const ROWS: CapabilityRow[] = [
  {
    key: "feedback",
    titleKey: "feedback.feature.title",
    descriptionKey: "feedback.feature.description",
  },
  {
    key: "blights",
    titleKey: "blights.feature.title",
    descriptionKey: "blights.feature.description",
  },
  {
    key: "beacon",
    titleKey: "beacon.feature.title",
    descriptionKey: "beacon.feature.description",
  },
  {
    key: "vitals",
    titleKey: "vitals.feature.title",
    descriptionKey: "vitals.feature.description",
  },
];

/**
 * What this app is allowed to report.
 *
 * These four used to be project-wide feature flags, which meant turning Blights
 * off for a noisy staging deployment turned it off for production too. They are
 * the sigil's own `kinds` now, and `SigilIngestService.gatesFor` reads nothing
 * else for Blights, Beacon and Vitals.
 *
 * Feedback is the one that still answers to the project as well: the same flag
 * governs the first-party form at `/p/:projectId/request`, which exists with no
 * app enrolled at all. Turning it on here lets *this* app's widget submit; the
 * module itself is switched in Project ▸ Settings ▸ Feedback.
 *
 * That asymmetry is why the Feedback row carries an extra line when the project
 * flag is off. A new sigil is minted carrying all four kinds, and a project
 * created through the wizard starts with `features.feedback: false` on purpose
 * — so the switch reads ON while `gatesFor` answers `feedback: false` and
 * `/sigils/config` omits `feedbackUrl` entirely. The switch is left usable (the
 * per-app decision is real, and it takes effect the moment the module is turned
 * on) but it must not claim an effect it does not have.
 *
 * Owner-only server-side, like rotate and delete. The switches are disabled for
 * a non-owner as a UX hint over `currentProjectMemberAtom.owner` — not a second
 * authorization boundary — and carry the same tooltip the rotate and delete
 * buttons do, so a disabled control always says who it is waiting for. See the
 * longer note on `AppSettings.tsx`.
 */
const AppSettingsCapabilities = () => {
  const { tr } = useI18n<I18n, "en">();
  const toaster = useToast();
  const router = useRouter<AppRouter>();
  const sigilApi = useClient<SigilController>();

  const [project] = useStore(currentProjectAtom);
  const [member] = useStore(currentProjectMemberAtom);
  const [sigil, setSigil] = useStore(currentSigilAtom);
  const [sigils, setSigils] = useStore(currentSigilsAtom);
  const [busy, setBusy] = useState(false);

  const isOwner = member?.owner ?? false;

  if (!project || !sigil) {
    return null;
  }

  const toggle = async (key: CapabilityKey, value: boolean) => {
    const current = new Set(sigil.kinds);
    if (value) {
      current.add(key);
    } else {
      current.delete(key);
    }

    setBusy(true);
    try {
      const updated = await sigilApi.updateSigil({
        params: { projectId: project.id, sigilId: sigil.id },
        body: { kinds: [...current] as CapabilityKey[] },
      });
      // Both copies: this page's, and the sidebar's — the Blights entry is
      // derived from exactly this field, so it has to move with the switch.
      setSigil(updated);
      setSigils(
        (sigils ?? []).map((it) => (it.id === updated.id ? updated : it)),
      );

      // currentSigilInsightsAtom is populated by the projectApp loader alone,
      // and a sibling-tab navigation (Settings → Analytics) reuses that
      // loader's layer instead of re-running it — so a flipped Beacon bit
      // leaves the atom (and whichever of Dashboard/Analytics/Performance/
      // Errors is rendered next) stale until something forces a reload.
      // Only Beacon needs this: Feedback, Blights and Vitals don't feed this
      // atom, and reloading on every toggle would throw away the range the
      // user picked for nothing.
      if (key === "beacon") {
        await router.reload();
      }
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {tr("app.settings.capabilities.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          {tr("app.settings.capabilities.description")}
        </p>
        {ROWS.map((row) => {
          // The one row whose switch does not, on its own, decide anything —
          // see the note on this component.
          const moduleOff =
            row.key === "feedback" && project.features?.feedback !== true;

          return (
            <div
              key={row.key}
              className="flex flex-col gap-2 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{tr(row.titleKey)}</span>
                <span className="text-muted-foreground text-xs">
                  {tr(row.descriptionKey)}
                </span>
                {moduleOff && (
                  <span className="text-amber-600 text-xs dark:text-amber-500">
                    {tr("app.settings.capabilities.feedbackModuleOff")}
                  </span>
                )}
              </div>
              <div className="flex justify-start sm:justify-end">
                {isOwner ? (
                  <Switch
                    checked={sigil.kinds.includes(row.key)}
                    disabled={busy}
                    aria-label={tr(row.titleKey)}
                    onCheckedChange={(value) => {
                      void toggle(row.key, value);
                    }}
                  />
                ) : (
                  // Wrapped in a span rather than handed to `render`: a
                  // disabled control swallows the pointer events the tooltip
                  // listens for, so the trigger has to be an element that is
                  // not itself disabled.
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Switch
                        checked={sigil.kinds.includes(row.key)}
                        disabled
                        aria-label={tr(row.titleKey)}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {tr("app.settings.ownerOnly")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default AppSettingsCapabilities;
