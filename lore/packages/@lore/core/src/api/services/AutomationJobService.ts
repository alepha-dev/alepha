import { $inject } from "alepha";
import { JobService } from "alepha/api/jobs";

import { AutomationOrigin } from "./AutomationOrigin.ts";

/**
 * A manual retry creates another execution ID, but retains its trusted origin.
 */
export class AutomationJobService extends JobService {
  protected readonly origin = $inject(AutomationOrigin);
  public override retryExecution(
    ...args: Parameters<JobService["retryExecution"]>
  ) {
    return this.origin.forJob(args[0], () => super.retryExecution(...args));
  }
}
