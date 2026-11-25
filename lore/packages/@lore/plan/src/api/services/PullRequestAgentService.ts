/**
 * A pull request reviewed by an agent job (#Q4251): a read job at
 * `pull/<n>/head`, or, for **review and fix**, a write job on the pull
 * request's own branch, which Bay asks GitHub for and refuses for a fork.
 * The run is the `review-pr` prompt's (#Q4275); what stays here is its time.
 */
export class PullRequestAgentService {
  /**
   * A review's time on the host; a fix gets a build's.
   */
  public static readonly REVIEW_SECONDS = 30 * 60;
  public static readonly FIX_SECONDS = 2 * 3600;
}
