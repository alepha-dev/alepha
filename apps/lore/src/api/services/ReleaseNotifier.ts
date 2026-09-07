import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";

import type { Project } from "../entities/projects.ts";
import type { Release } from "../entities/releases.ts";
import { LoreInboxNotifications } from "../notifications/LoreInboxNotifications.ts";
import { ProjectRoster } from "./ProjectRoster.ts";

/**
 * Tells a project that one of its releases shipped.
 *
 * ## Publish only
 *
 * `reopenRelease` notifies nobody. "Published by mistake" is real, and a
 * correction that mails the whole roster a second time is worse than the
 * mistake it corrects.
 *
 * ## `pushMany`, not a loop of `push`
 *
 * The primitive already emits one job row per contact per channel and takes
 * a `key` per contact. A hand-rolled loop would also have to re-derive the
 * channel suffix that `key` carries, and getting that wrong makes exactly
 * one of the two channels silently dedupe away.
 *
 * ⚠️ `pushMany` does **not** pre-filter suppressed contacts: the gate is at
 * send time, on purpose, because a suppression can land between the push and
 * the send. So the row count is the roster size, not the deliverable roster
 * size. Fine at Lore's scale, and worth knowing before somebody reads those
 * numbers as delivery figures.
 */
export class ReleaseNotifier {
  protected readonly alepha = $inject(Alepha);
  protected readonly log = $logger();
  protected readonly roster = $inject(ProjectRoster);
  protected readonly templates = $inject(LoreInboxNotifications);

  /**
   * Fan the published release out to every member but the publisher.
   *
   * Never throws: a release that published must not fail because a message
   * could not be queued.
   */
  public async published(options: {
    release: Release;
    project: Project;
    publisherId: string;
    /**
     * How many quests the release shipped, read off the contents the handler
     * already fetched. Never a third query: `publishRelease` reads the
     * contents once precisely so the frozen record cannot disagree with
     * itself.
     */
    questCount: number;
  }): Promise<void> {
    try {
      const recipients = await this.roster.others(
        options.project.id,
        options.publisherId,
      );
      if (recipients.length === 0) return;

      const baseUrl = this.alepha.env.PUBLIC_URL ?? "";
      const slug = options.project.slug || `project-${options.project.id}`;
      // ⚠️ `releases.tag` is optional, and the release URL is addressed BY
      // the tag. A release without one has no address of its own, so the
      // message names it by title and points at the list rather than at
      // `/releases/undefined`.
      const tag = options.release.tag;
      const href = tag ? `/${slug}/releases/${tag}` : `/${slug}/releases`;
      const variables = {
        releaseTag: tag || options.release.title,
        releaseTitle: options.release.title,
        projectTitle: options.project.title,
        questCount: options.questCount,
        href,
        url: `${baseUrl}${href}`,
        // Opaque, and the framework never parses it.
        scope: `project:${options.project.id}`,
      };

      await this.templates.inboxReleasePublished.pushMany({
        contacts: recipients.map((recipient) => ({
          contact: recipient.email,
          variables,
          // ⚠️ `pushMany` has NO language fallback at all - its own docs say
          // the field is explicit only, because a fan-out is usually a cron
          // with no request to read one from. There is no per-user language
          // to read either, so everybody gets the app default and that is a
          // known limitation rather than an oversight.
          lang: "en",
        })),
        // ⚠️ The release id is in the key, not just the contact. A key is
        // concurrency dedup and not idempotence over time - the job layer
        // clears it on both terminal states - so a bare contact key would
        // collide across two releases published in the same window.
        key: (contact) => `release-${options.release.id}-${contact}`,
      });
    } catch (error) {
      this.log.error("Failed to announce a published release", {
        releaseId: options.release.id,
        error,
      });
    }
  }
}
