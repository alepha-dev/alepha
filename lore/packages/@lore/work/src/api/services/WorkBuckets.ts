import { $storage } from "alepha/api/files";

import { FeedbackRateLimiter } from "./FeedbackRateLimiter.ts";

/**
 * The work package's buckets, as a boot class listed in its module (#Q3404).
 *
 * A `$storage` is a boot primitive: an upload names its bucket, and the
 * bucket is looked up by name among every declared one, so it has to exist
 * before the first request. Declared on a controller, it made the
 * controller a boot class; declared here, the controllers stay pure and
 * reach their bucket through this class.
 */
export class WorkBuckets {
  /**
   * Bucket for feedback attachments. Size cap mirrors `feedbackOptionsAtom`
   * — the bucket-level limit acts as a hard backstop in case the controller
   * check is bypassed. MIME whitelist is enforced at upload time (not here)
   * so it can read from the atom rather than baking values into `$storage`.
   */
  public readonly feedbackAttachments = $storage({
    name: FeedbackRateLimiter.ATTACHMENT_BUCKET,
    maxSize: 5,
  });

  public readonly questAttachments = $storage({
    // The property this bucket was declared under on `QuestController`,
    // which is what named it: every stored attachment row carries it.
    name: "attachments",
    description: "Quest attachments",
    // Megabytes. This read `10 * 1024 * 1024`, i.e. a ten-million-megabyte
    // cap — no cap at all.
    maxSize: 10,
    // No `mimeTypes`, on purpose: a quest carries whatever the work needs,
    // an HTML mockup included. `$storage` reads an absent list as "any
    // type", the same as the folio attachment bucket. A member is someone the
    // project already trusts; feedback attachments come from anyone with an
    // account and keep their own narrow list.
    //
    // This was a closed list until 2026-09-04, excluding `text/html` and
    // `image/svg+xml` on the grounds that `/api/files/:id` serves a file
    // inline with the type it was stored under, which would make an
    // attachment stored XSS against the members who open it. That premise
    // was already false when it was written: `serializeResponse` sets
    // `Content-Disposition: attachment` on every `z.file()` response, so
    // the browser saves the file instead of rendering it, whatever the type
    // claims to be (`ServerRouterProvider`, pinned by
    // `ServerRouterProvider-serializeResponse.spec.ts`).
    //
    // So the served DISPOSITION is what guards this bucket, not the list.
    // What to check before changing any of it:
    //
    // - Serve an attachment without that header, or with `inline`, and every
    //   markup type here becomes executable in this origin. A download route
    //   that writes its own headers is the thing to watch for.
    // - The lightbox renders images through `<img>` and everything else as
    //   highlighted source (`attachmentPreview`). `<img>` does not run
    //   an SVG's scripts; an `<iframe>` or a `dangerouslySetInnerHTML` over
    //   attachment bytes would.
    // - `LoreFileAccessProvider` gates reads on project membership, so a
    //   file uploaded here is never reachable by a stranger holding the id.
  });
}
