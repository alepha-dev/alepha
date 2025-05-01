import { t } from "@alepha/core";
import { PG_CREATED_AT, PG_DEFAULT } from "../constants/PG_SYMBOLS";
import { pgAttr } from "./pgAttr";

export const createdAtSchema = pgAttr(
	pgAttr(t.datetime(), PG_CREATED_AT),
	PG_DEFAULT,
);
