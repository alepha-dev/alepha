export * from "./asiaSeeds.ts";
export * from "./canadaSeeds.ts";
export * from "./europeSeeds.ts";
export * from "./types.ts";

import { asiaSeeds } from "./asiaSeeds.ts";
import { canadaSeeds } from "./canadaSeeds.ts";
import { europeSeeds } from "./europeSeeds.ts";
import type { SeedData } from "./types.ts";

export const seedSets: Record<string, SeedData> = {
  europe: europeSeeds,
  asia: asiaSeeds,
  canada: canadaSeeds,
};
