import { capabilityOption, ProjectLoaderRegistry } from "@lore/core/web";
import { $inject, Alepha } from "alepha";
import { $client } from "alepha/server/links";

import type { PersonaController } from "../../../api/controllers/PersonaController.ts";
import type { RequirementController } from "../../../api/controllers/RequirementController.ts";
import type { UseCaseController } from "../../../api/controllers/UseCaseController.ts";
import { requirementsCountsAtom } from "../atoms/requirementsCountsAtom.ts";

/**
 * What Requirements reads when a project opens, registered on core's
 * `ProjectLoaderRegistry`: the three sidebar counts. Nothing at all when the
 * project has Requirements off.
 *
 * The subject carries no rank, so each count is asked for and its own
 * permission answers: a refusal or a failure leaves that count absent, and
 * its entry, hidden for that rank anyway, shows none.
 */
export class RequirementsProjectLoader {
  protected readonly alepha = $inject(Alepha);
  protected readonly loaders = $inject(ProjectLoaderRegistry);
  protected readonly requirementApi = $client<RequirementController>();
  protected readonly useCaseApi = $client<UseCaseController>();
  protected readonly personaApi = $client<PersonaController>();

  constructor() {
    this.loaders.register({
      key: "plan-requirements",
      order: 20,
      load: async (project) => {
        if (!capabilityOption(project, "plan", "requirements")) {
          return () => this.alepha.store.set(requirementsCountsAtom, {});
        }
        const params = { projectId: project.id };
        const count = (call: Promise<{ count: number }>) =>
          call.then((r) => r.count).catch(() => undefined);
        const [requirements, useCases, personas] = await Promise.all([
          count(this.requirementApi.countRequirements({ params })),
          count(this.useCaseApi.countUseCases({ params })),
          count(this.personaApi.countPersonas({ params })),
        ]);
        return () =>
          this.alepha.store.set(requirementsCountsAtom, {
            requirements,
            useCases,
            personas,
          });
      },
      leave: () => this.alepha.store.set(requirementsCountsAtom, {}),
    });
  }
}
