import type { ProjectResource } from "../../../../../api/schemas/projectResourceSchema.ts";
import type {
  SpotlightSource,
  SpotlightSourceContext,
  SpotlightSourceGroup,
} from "../../../registries/SpotlightSourceRegistry.ts";
import { hasCapability } from "../../../services/projectCapabilities.ts";

export interface UseSpotlightSourcesOptions extends SpotlightSourceContext {
  /**
   * The registry's sources: frozen at its first read, so the same list on
   * every render.
   */
  sources: readonly SpotlightSource[];
  /**
   * The current project, whose capabilities decide which sources answer.
   */
  project?: Pick<ProjectResource, "capabilities">;
}

/**
 * Every registered source's group for the query (#E175). Each source is a
 * hook, called in the registry's order; the list never changes once read,
 * so the hooks keep their order from one render to the next. A source of a
 * capability the project has off is still called, for that order, but
 * reads nothing and its group is dropped.
 */
export const useSpotlightSources = (
  options: UseSpotlightSourcesOptions,
): SpotlightSourceGroup[] => {
  const groups: SpotlightSourceGroup[] = [];
  for (const source of options.sources) {
    const on =
      !source.capability || hasCapability(options.project, source.capability);
    const group = source.useGroup({
      query: on ? options.query : "",
      wanted: on && options.wanted,
    });
    if (on) groups.push(group);
  }
  return groups;
};
