import type { FeedbackSource } from "../../../../../api/schemas/feedbackSourceSchema.ts";

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 100;

/**
 * What the request page carries across the sign-in round trip: the tags and
 * the page context an embedded "report a bug" button sent in the URL.
 */
export type DraftContext = {
  tags?: string[];
  /**
   * Page-context provenance captured by the sigil button (see source schema).
   */
  source?: FeedbackSource;
};

/**
 * Read the request page's draft out of its query string.
 *
 * Its own file, not an export of `ProjectFeedbackRequest.tsx`: React Fast
 * Refresh only hot-swaps a file that exports components alone, so a helper
 * exported beside the page turned every edit of it into a full page reload.
 */
export const readDraftFromQuery = (query: URLSearchParams): DraftContext => {
  const tags = query
    .getAll("tags")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v.length <= MAX_TAG_LENGTH);

  // The embed launcher sends `type=bug|feature`: fold it into the tag set
  // (feedback has no first-class type column; tags carry the taxonomy).
  const typeParam = query.get("type")?.trim().toLowerCase();
  if (
    (typeParam === "bug" || typeParam === "feature") &&
    !tags.includes(typeParam)
  ) {
    tags.unshift(typeParam);
  }

  // Capped last: `feedbackBodySchema` refuses a 21st tag, and `type` counts.
  const draft: DraftContext = {};
  if (tags.length > 0) draft.tags = tags.slice(0, MAX_TAGS);

  // Page-context provenance forwarded by the sigil button via the
  // `/sigil/request` popup (keys defined in `@alepha/lore`). `url`
  // is the signal that this feedback originated from an embedded button; the
  // server schema (`feedbackSourceSchema`) re-validates every field on submit.
  const url = query.get("url")?.trim();
  if (url) {
    const source: FeedbackSource = {
      hostUrl: url,
      hostPath: query.get("path")?.trim() || url,
      userAgent: query.get("ua")?.trim() || "",
    };
    const title = query.get("title")?.trim();
    const referrer = query.get("ref")?.trim();
    const language = query.get("lang")?.trim();
    const viewport = query.get("vp")?.trim();
    const screen = query.get("scr")?.trim();
    const timezone = query.get("tz")?.trim();
    if (title) source.title = title;
    if (referrer) source.referrer = referrer;
    if (language) source.language = language;
    if (viewport) source.viewport = viewport;
    if (screen) source.screen = screen;
    if (timezone) source.timezone = timezone;
    draft.source = source;
  }

  return draft;
};
