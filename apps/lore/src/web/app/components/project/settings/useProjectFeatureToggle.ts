import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useState } from "react";

import type { ProjectCapabilityController } from "@/api/controllers/ProjectCapabilityController.ts";
import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";

/**
 * ⚠️ **A bridge, and a temporary one.** The eight settings pages still ask for
 * a `features.*` key by name; the four capability pages that replace them, and
 * the `useCapabilityToggle` / `useCapabilityOption` pair they call, are their
 * own quest. Until then this maps each old key onto the capability (and the
 * option inside it) that now holds the answer, so there is exactly ONE write
 * path for a capability from the day the table exists.
 *
 * That single-write-path property is the reason this file exists at all rather
 * than `features` staying on `updateProjectById` for three more quests:
 * dual-writing means two sources of truth, and two sources of truth for the
 * length of an epic is how they come to disagree.
 *
 * `sigils` maps to the Apps master AND turns `track` on, because that is what
 * the flag meant: it gated the telemetry surfaces. `quality` maps to the Apps
 * master alone, since Quality joins the Apps baseline and loses its switch.
 */
const FEATURE_TO_CAPABILITY: Record<
  string,
  { key: CapabilityKey; option?: string; withOptions?: Record<string, boolean> }
> = {
  kanban: { key: "work", option: "board" },
  milestones: { key: "work", option: "releases" },
  epics: { key: "work", option: "epics" },
  questEstimate: { key: "work", option: "estimate" },
  questChrono: { key: "work", option: "chrono" },
  questReminder: { key: "work", option: "reminder" },
  folios: { key: "knowledge" },
  folioSummary: { key: "knowledge", option: "agentSummary" },
  feedback: { key: "support" },
  sigils: { key: "apps", withOptions: { track: true } },
  quality: { key: "apps" },
};

export interface FeatureToggle {
  enabled: boolean;
  toggle: (value: boolean) => Promise<void>;
}

export const useProjectFeatureToggle = (key: string): FeatureToggle => {
  const alepha = useAlepha();
  const capabilityApi = useClient<ProjectCapabilityController>();
  const [project] = useStore(currentProjectAtom);
  const [pending, setPending] = useState<boolean | undefined>(undefined);
  const toaster = useToast();

  const mapped = FEATURE_TO_CAPABILITY[key];
  const entry = project?.capabilities.find((it) => it.key === mapped?.key);
  const persisted = mapped?.option
    ? entry?.options[mapped.option] === true
    : entry !== undefined;
  const enabled = pending ?? persisted;

  const toggle = async (value: boolean) => {
    if (!project || !mapped) return;
    setPending(value);
    try {
      // Options are sent WHOLE — the write replaces rather than merges, which
      // is what lets a key be cleared by omission. So the ones this toggle is
      // not touching are carried forward from what the resource already says.
      const options = { ...entry?.options, ...mapped.withOptions };
      const body = mapped.option
        ? // An option toggle keeps its capability on. Sending `enabled: true`
          // also creates the row when the capability was off, which is what a
          // page reached with the master already on can rely on.
          {
            enabled: true,
            options: { ...options, [mapped.option]: value },
          }
        : { enabled: value, options };

      const updated = await capabilityApi.setCapability({
        params: { projectId: project.id, key: mapped.key },
        body,
      });
      alepha.store.set(currentProjectAtom, updated);
      const overview = alepha.store.get(userProjectsAtom);
      if (overview) {
        alepha.store.set(userProjectsAtom, {
          ...overview,
          // `setCapability`'s response has neither `areaCount` nor
          // `openQuestCount` — only `getHomeOverview` computes those — so
          // carry the existing ones forward rather than dropping them to 0.
          projects: overview.projects.map((p) =>
            p.id === updated.id
              ? {
                  ...updated,
                  areaCount: p.areaCount,
                  openQuestCount: p.openQuestCount,
                }
              : p,
          ),
        });
      }
      setPending(undefined);
    } catch (error) {
      setPending(undefined);
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };

  return { enabled, toggle };
};
