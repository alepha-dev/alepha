import { z } from "alepha";
import {
  PG_DEFAULT,
  PG_PRIMARY_KEY,
  PG_SERIAL,
} from "../constants/PG_SYMBOLS.ts";
import { pgAttr } from "../helpers/pgAttr.ts";

/**
 * @deprecated Use `pg.primaryKey()` instead.
 */
export const legacyIdSchema = pgAttr(
  pgAttr(pgAttr(z.integer(), PG_PRIMARY_KEY), PG_SERIAL),
  PG_DEFAULT,
);
