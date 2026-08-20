import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useState } from "react";
import type { ProjectController } from "@/api/controllers/ProjectController.ts";
import {
  defaultProjectFeatures,
  type ProjectFeatures,
} from "@/api/entities/projects.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";

type FeatureKey = keyof ProjectFeatures;

export interface FeatureToggle {
  enabled: boolean;
  toggle: (value: boolean) => Promise<void>;
}

export const useProjectFeatureToggle = (key: FeatureKey): FeatureToggle => {
  const alepha = useAlepha();
  const projectApi = useClient<ProjectController>();
  const [project] = useStore(currentProjectAtom);
  const [pending, setPending] = useState<boolean | undefined>(undefined);
  const toaster = useToast();

  const persisted = {
    ...defaultProjectFeatures,
    ...project?.features,
  };
  // Optional schema keys (questReminder/questChrono/...) read as
  // `undefined` for old rows that don't carry them yet — coerce to
  // false so the Switch never receives undefined.
  const enabled = pending ?? persisted[key] ?? false;

  const toggle = async (value: boolean) => {
    if (!project) return;
    setPending(value);
    try {
      const updated = await projectApi.updateProjectById({
        params: { id: project.id },
        body: { features: { [key]: value } },
      });
      alepha.store.set(currentProjectAtom, updated);
      const overview = alepha.store.get(userProjectsAtom);
      if (overview) {
        alepha.store.set(userProjectsAtom, {
          ...overview,
          // `updateProjectById`'s response has no `areaCount` — only
          // `getHomeOverview` computes that — so carry the existing one
          // forward rather than dropping it to 0.
          projects: overview.projects.map((p) =>
            p.id === updated.id ? { ...updated, areaCount: p.areaCount } : p,
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
