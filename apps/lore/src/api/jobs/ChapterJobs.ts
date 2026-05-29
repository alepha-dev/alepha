import { $inject } from "alepha";
import { $job } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { ChapterController } from "../controllers/ChapterController.ts";

/**
 * Background jobs for chapters: currently just auto-close of chapters
 * whose `closesAt` deadline has elapsed.
 */
export class ChapterJobs {
  protected readonly log = $logger();
  protected readonly chapterController = $inject(ChapterController);
  protected readonly dt = $inject(DateTimeProvider);

  /**
   * Auto-close any active chapter whose `closesAt` is in the past.
   * Runs hourly — chapters span days/weeks so finer granularity isn't needed
   * (and sharing the `0 * * * *` slot keeps the Cloudflare cron-trigger count
   * down).
   */
  public readonly autoCloseExpiredChapters = $job({
    cron: "0 * * * *",
    handler: async () => {
      const now = this.dt.nowISOString();
      const expired = await this.chapterController.findExpiredChapters(now);
      if (expired.length === 0) return;

      for (const chapter of expired) {
        try {
          await this.chapterController.finalizeChapter(chapter);
          this.log.info(
            `Auto-closed chapter ${chapter.id} (#${chapter.number}) — deadline passed`,
          );
        } catch (err) {
          this.log.warn(
            `Auto-close failed for chapter ${chapter.id}: ${String(err)}`,
          );
        }
      }
    },
  });
}
