import { BookText, ListChecks, UsersRound } from "lucide-react";

/**
 * The Requirements page's three tabs, in the owner's order (#E153, answer
 * 70): the route each opens, its label and the permission that draws it.
 * Read by the layout and by the sidebar entry's `activeOn`.
 */
export const REQUIREMENTS_TABS = [
  {
    route: "projectRequirements",
    labelKey: "requirements.tab.requirements",
    icon: ListChecks,
    permission: "requirement:read",
  },
  {
    route: "projectUseCases",
    labelKey: "requirements.tab.useCases",
    icon: BookText,
    permission: "usecase:read",
  },
  {
    route: "projectPersonas",
    labelKey: "requirements.tab.personas",
    icon: UsersRound,
    permission: "persona:read",
  },
] as const;

/**
 * Every route under `/requirements`: the layout, its three tabs and the
 * persona and use case pages, which keep the sidebar entry lit.
 */
export const REQUIREMENTS_ROUTES: readonly string[] = [
  "projectRequirementsLayout",
  ...REQUIREMENTS_TABS.map((tab) => tab.route),
  "projectPersona",
  "projectUseCase",
];
