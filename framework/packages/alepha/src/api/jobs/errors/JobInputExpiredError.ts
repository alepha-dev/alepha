import { $error, z } from "alepha";

/**
 * A run parked on `step.input` reached the entry's `until` with no answer.
 * Terminal: the run fails without a retry, since nobody is left to answer.
 */
export const JobInputExpiredError = $error({
  name: "JOB_INPUT_EXPIRED",
  schema: z.object({
    job: z.text(),
    step: z.text(),
    until: z.text(),
  }),
  message: (data) =>
    `Job '${data.job}' waited for input '${data.step}' until ${data.until}, and none came`,
});

export type JobInputExpiredError = InstanceType<typeof JobInputExpiredError>;
