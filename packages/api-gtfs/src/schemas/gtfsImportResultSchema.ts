import { type Static, t } from "@alepha/core";

/**
 * GTFS import result schema
 */
export const gtfsImportResultSchema = t.object({
	dataset: t.string({ description: "Name of the imported dataset" }),
	success: t.boolean({ description: "Whether the import was successful" }),
	counts: t.object({
		stops: t.int(),
		routes: t.int(),
		trips: t.int(),
		stopTimes: t.int(),
		calendar: t.int(),
		calendarDates: t.int(),
	}),
	message: t.optional(
		t.string({ description: "Error message if import failed" }),
	),
});

export type GTFSImportResult = Static<typeof gtfsImportResultSchema>;
