import { type Infer, z } from "alepha";

/**
 * The quest rail's pull request review (#Q4251): whether the member trusts
 * the pull request's author, so the host does not check that they can write
 * to the repository first.
 */
export const pullRequestReviewFormSchema = z.object({
  trust: z.boolean(),
});

export type PullRequestReviewForm = Infer<typeof pullRequestReviewFormSchema>;
