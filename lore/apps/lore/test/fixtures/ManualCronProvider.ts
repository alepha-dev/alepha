import { $hook } from "alepha";
import { CronProvider } from "alepha/scheduler";

/**
 * Registers real cron metadata while scenarios invoke ticks explicitly.
 */
export class ManualCronProvider extends CronProvider {
  protected override readonly start = $hook({ on: "start", handler: () => {} });
}
