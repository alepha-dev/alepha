import { t } from "@alepha/core";
import { PG_DEFAULT, PG_PRIMARY_KEY, PG_SERIAL } from "../constants/PG_SYMBOLS";
import { pgAttr } from "./pgAttr";

export const legacyIdSchema = pgAttr(
	pgAttr(pgAttr(t.int(), PG_PRIMARY_KEY), PG_SERIAL),
	PG_DEFAULT,
);
