import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import { useAlepha, useClient, useStore } from "alepha/react";
import { useState } from "react";

import type { ProjectCapabilityController } from "@/api/controllers/ProjectCapabilityController.ts";
import type { CapabilityKey } from "@/api/schemas/capabilityKeySchema.ts";
import { currentProjectAtom } from "@/web/app/atoms/currentProjectAtom.ts";
import { userProjectsAtom } from "@/web/app/atoms/userProjectsAtom.ts";
import { capabilityRegistry } from "@/web/app/services/capabilityRegistry.ts";
import { setCurrentProject } from "@/web/app/services/currentProjectWrite.ts";
import {
  capabilityOption,
  hasCapability,
} from "@/web/app/services/projectCapabilities.ts";

export interface CapabilitySwitch {
  enabled: boolean;
  toggle: (value: boolean) => Promise<void>;
  /**
   * Whether the viewer may move this switch at all.
   *
   * ⚠️ Disabled rather than hidden, and this is the exception the rule allows:
   * a capability settings page with its switch removed is a page that says
   * nothing at all. The reader sees the state and cannot change it, which is
   * the honest rendering of `capability:manage` being owner-only.
   */
  canToggle: boolean;
}

/**
 * Turn a capability on or off from its settings page.
 *
 * ⚠️ **There is no floor here, and that is the decision.** Every capability
 * may go off, the last one included: a project with none is a legal state and
 * the test that the modularity is real. The creation wizard keeps its
 * at-least-one rule, because a wizard is asking a question and "none" is not
 * an answer to one; Settings is not asking anything.
 *
 * ⚠️ **The switch is optimistic and the server is not.** `enabled` reads
 * `pending ?? persisted`, so it flips the instant the click fires. A spec that
 * asserts on the switch's own state proves nothing about what was stored -
 * arm `waitForResponse` before the click, or read the project back.
 */
export const useCapabilityToggle = (key: CapabilityKey): CapabilitySwitch => {
  const write = useCapabilityWrite();
  const can = useCapabilityCan();
  const [project] = useStore(currentProjectAtom);
  const [pending, setPending] = useState<boolean | undefined>(undefined);

  return {
    canToggle: can,
    enabled: pending ?? hasCapability(project, key),
    toggle: async (value) => {
      setPending(value);
      const stored = optionsOf(project, key);
      await write(key, {
        enabled: value,
        // The options ride along unchanged - they are sent whole on every
        // write, so omitting them would clear every switch inside the
        // capability as a side effect of turning it on.
        //
        // ⚠️ Except on the FIRST enable, where there is no row and therefore
        // nothing to carry. Sending `{}` there gives Apps with nothing tracked
        // and Work with no board, which is not what the wizard would have made
        // and is a dead end the reader has to discover. The registry's
        // preselection is the same answer the wizard gives.
        options:
          value && Object.keys(stored).length === 0
            ? capabilityRegistry.preselectedOptionsOf(key)
            : stored,
      });
      setPending(undefined);
    },
  };
};

/**
 * Turn one option inside a capability on or off.
 *
 * Sends `enabled: true` alongside, which CREATES the capability row when it
 * was off. That is what a page reached with the master already on can rely
 * on, and it is also why a settings page never has to order its two writes.
 */
export const useCapabilityOption = (
  key: CapabilityKey,
  option: string,
): CapabilitySwitch => {
  const write = useCapabilityWrite();
  const can = useCapabilityCan();
  const [project] = useStore(currentProjectAtom);
  const [pending, setPending] = useState<boolean | undefined>(undefined);

  return {
    canToggle: can,
    enabled: pending ?? capabilityOption(project, key, option),
    toggle: async (value) => {
      setPending(value);
      await write(key, {
        enabled: true,
        options: { ...optionsOf(project, key), [option]: value },
      });
      setPending(undefined);
    },
  };
};

const optionsOf = (
  project:
    | { capabilities: Array<{ key: string; options: Record<string, boolean> }> }
    | undefined,
  key: CapabilityKey,
): Record<string, boolean> =>
  project?.capabilities.find((it) => it.key === key)?.options ?? {};

/**
 * The one write, and the two atoms it refreshes.
 *
 * `setCapability` answers the whole project resource precisely so this is one
 * round-trip: `currentProjectAtom` drives every gate on the page you are
 * standing on, and `userProjectsAtom` drives the Home cards you go back to.
 */
const useCapabilityWrite = () => {
  const alepha = useAlepha();
  const api = useClient<ProjectCapabilityController>();
  const [project] = useStore(currentProjectAtom);
  const toaster = useToast();

  return async (
    key: CapabilityKey,
    body: { enabled: boolean; options?: Record<string, boolean> },
  ) => {
    if (!project) return;
    try {
      // ⚠️ The response carries `permissions` as well as the project, and it
      // has to: turning a capability ON widens the effective set, so a client
      // that kept the set it already had would leave the new capability's
      // sidebar entries hidden until the next navigation.
      const updated = await api.setCapability({
        params: { projectId: project.id, key },
        body,
      });
      setCurrentProject(alepha, updated);
      const overview = alepha.store.get(userProjectsAtom);
      if (overview) {
        alepha.store.set(userProjectsAtom, {
          ...overview,
          // The response carries neither `areaCount` nor `openQuestCount` —
          // only `getHomeOverview` computes those — so carry the existing
          // ones forward rather than dropping them to 0.
          projects: overview.projects.map((p) =>
            p.id === updated.id
              ? {
                  ...updated,
                  areaCount: p.areaCount,
                  openQuestCount: p.openQuestCount,
                  // Same reasoning: `owner` is computed by `getHomeOverview`
                  // from a batched `members` read, so an update response has
                  // no idea and dropping it would flip the Owner badge off.
                  owner: p.owner,
                }
              : p,
          ),
        });
      }
    } catch (error) {
      toaster.error(error instanceof Error ? error.message : String(error));
    }
  };
};

/**
 * May the viewer move a capability switch?
 *
 * ⚠️ `capability:manage` is owner-only STRUCTURALLY: turning a capability ON
 * widens every rank's effective set at once, the actor's own included, and the
 * subset rule does not catch it because a switch is not a grant. Read off the
 * ACTION, so this repeats no permission string - the requirement travels from
 * `$ownsProject({ requires })` through the registry to `can()`.
 */
const useCapabilityCan = (): boolean =>
  useClient<ProjectCapabilityController>().setCapability.can();
