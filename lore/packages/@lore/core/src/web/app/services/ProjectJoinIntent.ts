/**
 * A join the visitor asked for, carried across sign-in.
 *
 * Clicking **Join project** while signed out writes it, then sends the visitor
 * to sign in with the page's URL as `?redirect=`. Password sign-in, sign-up
 * and the Google round trip all return to that URL in the same tab, where the
 * project route takes the intent and completes the join as a viewer.
 *
 * It lives in `sessionStorage`, so it never outlives the tab, and it names
 * one project and expires after {@link TTL}: merely opening a project link,
 * later or in another tab, never enrolls anyone. Every read and write is in a
 * `try`, since storage can be absent or refuse (a private window, a blocked
 * site); without it the visitor clicks Join once more after signing in.
 */
export class ProjectJoinIntent {
  public static readonly KEY = "lore.projectJoinIntent";

  /**
   * How long a join started before sign-in stays good: long enough for a
   * sign-up and an email check, short enough to be a decision just made.
   */
  public static readonly TTL = 30 * 60 * 1000;

  public static remember(slug: string, now: number): void {
    try {
      sessionStorage.setItem(
        ProjectJoinIntent.KEY,
        JSON.stringify({ slug, at: now }),
      );
    } catch {
      // Storage refused: the visitor joins with a second click instead.
    }
  }

  /**
   * Whether a live intent names this project. Taking it consumes it, so a
   * refused join is not retried on every navigation. An intent for another
   * project is left where it is.
   */
  public static take(slug: string, now: number): boolean {
    try {
      const raw = sessionStorage.getItem(ProjectJoinIntent.KEY);
      if (!raw) return false;
      const intent = JSON.parse(raw) as { slug?: unknown; at?: unknown };
      const expired =
        typeof intent.at !== "number" ||
        now - intent.at > ProjectJoinIntent.TTL ||
        intent.at > now;
      if (expired) {
        sessionStorage.removeItem(ProjectJoinIntent.KEY);
        return false;
      }
      if (intent.slug !== slug) return false;
      sessionStorage.removeItem(ProjectJoinIntent.KEY);
      return true;
    } catch {
      return false;
    }
  }
}
