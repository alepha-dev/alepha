import { z } from "alepha";

/**
 * A room's name as a person types it (#E161): lower-case letters, digits and
 * hyphens, starting with a letter or a digit, the way `#general` is spelled
 * in a mention or a link. Trimmed and lower-cased before it is checked.
 */
export const chatRoomNameSchema = z.text({
  minLength: 1,
  maxLength: 80,
  trim: true,
  lowercase: true,
  pattern: /^[a-z0-9][a-z0-9-]*$/,
});
