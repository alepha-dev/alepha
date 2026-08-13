import { $hook, $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { AnalyticsRollupJobs } from "../jobs/AnalyticsRollupJobs.ts";
import { $analytics } from "../primitives/$analytics.ts";

/**
 * Warns at boot when a dataset declares `retention.hot` but nothing will
 * ever enforce it.
 *
 * `retention` is inert by construction: it is read only by
 * `AnalyticsRollupJobs`, which lives in the separate `AlephaApiAnalyticsRollup`
 * module (not `AlephaApiAnalytics`) — see that module's doc in `index.ts` for
 * why. An app can declare `$analytics({ retention: { hot: "60d" } })`,
 * import only `AlephaApiAnalytics`, and get a table that grows forever with no
 * error anywhere: `register()`, `record()` and `query()` all work perfectly
 * normally regardless of whether anything ever prunes them. That silence is
 * exactly the failure mode `WaeAnalyticsProvider.onStart` already guards
 * against for its own "silently inert" risk (a missing Workers binding) —
 * this class does the equivalent check for a missing rollup module.
 *
 * Always part of `AlephaApiAnalytics.services`, so it runs regardless of
 * whether `AlephaApiAnalyticsRollup` is ever imported — the whole point is to
 * catch the case where it is not. It imports `AnalyticsRollupJobs` only to
 * check whether one was constructed (`Alepha.services()`), never to
 * construct one itself, so this file does not pull `alepha/api/jobs` (and
 * the real database it needs) into every app that merely declares a
 * dataset — the same DB-cascade problem `AlephaApiAnalyticsRollup` itself
 * exists to avoid. The import direction only goes one way (this file reads
 * `AnalyticsRollupJobs`; `AnalyticsRollupJobs.ts` never reads this file),
 * so there is no circular import between the two.
 */
export class AnalyticsRetentionGuard {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);

  /**
   * `"start"`, not `onInit` on the primitive itself: every `$analytics()`
   * dataset in the app has to have been constructed first, and a class
   * holding one might not be injected until some other service's own
   * construction pulls it in. By `alepha.start()`, the DI graph has settled
   * — the same timing assumption `WaeAnalyticsProvider.onStart` and
   * `JobProvider`'s own "Job system OK" summary log both already make.
   */
  protected readonly assertSweepWired = $hook({
    on: "start",
    handler: () => this.check(),
  });

  protected check(): void {
    const withHot = this.alepha
      .primitives($analytics)
      .filter((primitive) => primitive.dataset.retention?.hot);
    if (withHot.length === 0) {
      return;
    }

    // A real instance, not just the class being wired — `Alepha.services()`
    // reflects what was actually constructed, so this cannot be fooled by
    // `AlephaApiAnalyticsRollup` being merely imported without ever running.
    if (this.alepha.services(AnalyticsRollupJobs).length > 0) {
      return;
    }

    const names = withHot.map((primitive) => primitive.dataset.name).join(", ");
    this.log.warn(
      `Dataset(s) [${names}] declare 'retention.hot' but AlephaApiAnalyticsRollup is not ` +
        "imported, so retention is never enforced — the table(s) will grow forever. " +
        "Import AlephaApiAnalyticsRollup (from 'alepha/api/analytics') alongside AlephaApiAnalytics " +
        "to run the scheduled sweep.",
    );
  }
}
