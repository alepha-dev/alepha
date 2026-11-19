import { z } from "alepha";

/**
 * A message's Markdown as a member writes it (#E161, #Q3926): 4000
 * characters, about two screens of a phone, after trimming. Longer belongs
 * in a folio and a link.
 */
export const chatMessageBodySchema = z.text({
  minLength: 1,
  maxLength: 4000,
  trim: true,
});
