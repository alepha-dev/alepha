import type { Release } from "../entities/releases.ts";

/**
 * One check a release must pass before it is published (#E153, #Q3774).
 * It throws to refuse, with a message the publisher reads.
 */
export interface ReleasePublishGuard {
  /**
   * Who registered it, for a log line.
   */
  name: string;
  check: (release: Release) => Promise<void>;
}

/**
 * The checks `publishRelease` runs before it freezes a release, shaped like
 * core's `ProjectCapabilityGuards`. Plan registers none: a package that
 * builds on Plan (Requirements, whose Must requirements can block a
 * release) registers its own, so Plan never imports it.
 */
export class ReleasePublishGuards {
  protected readonly guards: ReleasePublishGuard[] = [];

  public register(guard: ReleasePublishGuard): void {
    this.guards.push(guard);
  }

  /**
   * Run every guard in registration order; the first refusal stops it.
   */
  public async assertCanPublish(release: Release): Promise<void> {
    for (const guard of this.guards) {
      await guard.check(release);
    }
  }
}
