import { t } from "@alepha/core";
import { PG_CREATED_AT, PG_DEFAULT } from "../constants/PG_SYMBOLS.ts";
import { pgAttr } from "../helpers/pgAttr.ts";

export const createdAtSchema = pgAttr(
	pgAttr(t.datetime(), PG_CREATED_AT),
	PG_DEFAULT,
);
