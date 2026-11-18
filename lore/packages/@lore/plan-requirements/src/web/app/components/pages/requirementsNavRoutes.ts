/**
 * The routes that light each Requirements sidebar entry (#E153): a list
 * page, and the pages a row of it opens.
 */
export const REQUIREMENTS_NAV_ROUTES = {
  requirements: ["projectRequirements", "projectRequirementsTestBook"],
  useCases: ["projectUseCases", "projectUseCase"],
  personas: ["projectPersonas", "projectPersona"],
} as const satisfies Record<string, readonly string[]>;
