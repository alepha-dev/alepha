import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EstatePullController } from "../src/api/controllers/EstatePullController.ts";
import {
  estateBackupsListResultSchema,
  estateBackupVerifyResultSchema,
  estateRestoreResultSchema,
  estateTargetProbeResultSchema,
} from "../src/schemas/index.ts";

/**
 * The backup answers, pinned from the Lore side, as `logs-result.json` is.
 *
 * Bay's `cmd/bay/testdata/backup-results/` (copied in
 * `fixtures/bay/backup-results/`) holds what each verb uploads; Bay's
 * `TestBackupResultsMatchTheSharedFixtures` refuses an upload carrying a field
 * these files lack. This asserts Lore accepts every file and strips nothing,
 * so a field one side adds alone goes red on one side or the other.
 */
const DIR = join(import.meta.dirname, "fixtures/bay/backup-results");
const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(DIR, name), "utf8"));

const PINNED = [
  ["backups-list.json", "backups-list", estateBackupsListResultSchema],
  ["backup-verify.json", "backup-verify", estateBackupVerifyResultSchema],
  ["target-probe.json", "target-probe", estateTargetProbeResultSchema],
  ["restore-dry-run.json", "restore", estateRestoreResultSchema],
] as const;

describe("The results backup commands upload, shared with Bay", () => {
  for (const [file, kind, schema] of PINNED) {
    it(`accepts ${file} exactly as Bay marshals it`, () => {
      const parsed = schema.parse(load(file));
      expect(parsed).toEqual(load(file));
    });

    it(`routes a ${kind} answer to that schema`, () => {
      expect(EstatePullController.RESULT_SCHEMAS[kind]).toBe(schema);
    });
  }

  it("has no answer for the verbs that only ack", () => {
    for (const kind of ["backup", "backup-policy", "restart"] as const) {
      expect(EstatePullController.RESULT_SCHEMAS[kind]).toBeUndefined();
    }
  });

  it("refuses a listing past the cap the route stores", () => {
    const listing = load("backups-list.json") as {
      backups: unknown[];
    };
    const big = {
      ...listing,
      backups: Array.from({ length: 501 }, () => listing.backups[0]),
    };
    expect(estateBackupsListResultSchema.safeParse(big).success).toBe(false);
  });
});
