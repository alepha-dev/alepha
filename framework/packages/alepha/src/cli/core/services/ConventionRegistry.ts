import { $inject } from "alepha";

import type { ConventionRule } from "../conventions/ConventionRule.ts";
import { DescribeItRule } from "../conventions/DescribeItRule.ts";
import { NoBareErrorRule } from "../conventions/NoBareErrorRule.ts";
import { NoDateNowRule } from "../conventions/NoDateNowRule.ts";
import { NoErrorClassRule } from "../conventions/NoErrorClassRule.ts";
import { NoModuleCodeRule } from "../conventions/NoModuleCodeRule.ts";
import { NoViMockRule } from "../conventions/NoViMockRule.ts";
import { NoWindowDialogRule } from "../conventions/NoWindowDialogRule.ts";
import { NoZodImportRule } from "../conventions/NoZodImportRule.ts";

/**
 * Every convention rule `alepha check` knows, in the order it lists them.
 *
 * The single source for the command, the generated reference page and the
 * scaffolded `AGENTS.md`, so none of them can name a rule that does not
 * exist. Each rule is injected by class: substitute a subclass in the
 * container (`.with({ provide: NoDateNowRule, use: MyRule })`) and the
 * registry, and so every reader of it, holds the subclass.
 */
export class ConventionRegistry {
  protected readonly rules: ConventionRule[] = [
    $inject(NoDateNowRule),
    $inject(NoBareErrorRule),
    $inject(NoErrorClassRule),
    $inject(NoZodImportRule),
    $inject(NoViMockRule),
    $inject(DescribeItRule),
    $inject(NoModuleCodeRule),
    $inject(NoWindowDialogRule),
  ];

  /**
   * Every registered rule.
   */
  public list(): ConventionRule[] {
    return [...this.rules];
  }

  /**
   * The rule with this id, or `undefined`.
   */
  public get(id: string): ConventionRule | undefined {
    return this.rules.find((rule) => rule.id === id);
  }

  /**
   * Every registered id, for an error message that names the valid ones.
   */
  public ids(): string[] {
    return this.rules.map((rule) => rule.id);
  }
}
