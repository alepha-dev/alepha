/**
 * Letter rank shown for a quest's difficulty (1–5 → F/C/B/A/S). A property
 * of the quest, not of any member — kept when character progression was
 * removed.
 */
export const getQuestRank = (difficulty: number): string => {
  if (difficulty === 2) return "C";
  if (difficulty === 3) return "B";
  if (difficulty === 4) return "A";
  if (difficulty === 5) return "S";
  return "F";
};
