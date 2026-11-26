import { $error, z } from "alepha";

/**
 * `JobProvider.answerInput` found nothing to answer: the execution is not
 * parked on that input (unknown, running, finished, cancelled, expired), or
 * the input was answered already.
 */
export const JobInputNotAwaitedError = $error({
  name: "JOB_INPUT_NOT_AWAITED",
  schema: z.object({
    executionId: z.text(),
    step: z.text(),
  }),
  message: (data) =>
    `Execution ${data.executionId} is not waiting for input '${data.step}'`,
});

export type JobInputNotAwaitedError = InstanceType<
  typeof JobInputNotAwaitedError
>;
