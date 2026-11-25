import type {
  SpotlightSource,
  SpotlightSourceContext,
  SpotlightSourceGroup,
} from "../../../registries/SpotlightSourceRegistry.ts";

export interface UseSpotlightSourcesOptions extends SpotlightSourceContext {
  /**
   * The registry's sources: frozen at its first read, so the same list on
   * every render.
   */
  sources: readonly SpotlightSource[];
}

/**
 * Every registered source's group for the query (#E175). Each source is a
 * hook, called in the registry's order; the list never changes once read,
 * so the hooks keep their order from one render to the next.
 */
export const useSpotlightSources = (
  options: UseSpotlightSourcesOptions,
): SpotlightSourceGroup[] => {
  const context: SpotlightSourceContext = {
    query: options.query,
    wanted: options.wanted,
  };
  const groups: SpotlightSourceGroup[] = [];
  for (const source of options.sources) {
    groups.push(source.useGroup(context));
  }
  return groups;
};
