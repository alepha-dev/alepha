/**
 * How many feedback rows the inbox asks for at a time.
 *
 * Shared between the route loader (which fetches the first page) and the
 * page (which fetches the rest), because the two have to agree: the loader
 * decides where the second page starts, and `Show more` computes its offset
 * from the rows already on screen. A mismatch skips or repeats rows with
 * nothing going red.
 *
 * `listFeedback` defaults to this same ten and caps at fifty; the value is
 * sent explicitly rather than left to that default, so raising the server's
 * ceiling cannot silently move the client's arithmetic.
 */
export const FEEDBACK_PAGE_SIZE = 10;
