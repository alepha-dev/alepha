import { z } from "alepha";

/**
 * The longest organisation name kept. Registry names run to about sixty
 * characters; anything longer is truncated, not refused.
 */
const MAX_NAME = 96;

/**
 * The visitor's network on the wire: its autonomous system number and the
 * name of the organisation that owns it, when the platform knows them.
 */
export const sigilNetworkSchema = z.object({
  number: z.integer().min(0).max(4_294_967_295),
  name: z.string().max(MAX_NAME).optional(),
});

export interface SigilNetwork {
  number: number;
  name?: string;
}

/**
 * A network as a sender or a sink may keep it, or `undefined` when the
 * value is not one.
 *
 * The proxy normalises what the platform gave it, and the sink normalises
 * again what arrived, since anyone holding a token can put anything on the
 * wire: the number must be a 32-bit unsigned integer, and the name loses
 * control characters, surrounding space and anything past its cap.
 */
export const sigilNetwork = (value: unknown): SigilNetwork | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const { number, name } = value as { number?: unknown; name?: unknown };
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number < 0 ||
    number > 4_294_967_295
  ) {
    return undefined;
  }
  const clean =
    typeof name === "string"
      ? name
          .replace(/\p{Cc}/gu, "")
          .trim()
          .slice(0, MAX_NAME)
          .trim()
      : "";
  return clean ? { number, name: clean } : { number };
};
