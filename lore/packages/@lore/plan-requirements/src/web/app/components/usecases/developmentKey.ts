/**
 * The "$1 / $2 quests" line's key for a total: "1 / 1 quest", "1 / 2
 * quests" (#E153).
 */
export const developmentKey = (total: number) =>
  total === 1
    ? ("requirements.usecase.development.one" as const)
    : ("requirements.usecase.development" as const);
