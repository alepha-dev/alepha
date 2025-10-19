import { type Static, t } from "@alepha/core";

/**
 * GTFS CalendarDate entity schema
 */
export const gtfsCalendarDateSchema = t.object({
	serviceId: t.string({ description: "Service identifier" }),
	date: t.string({ description: "Date in YYYYMMDD format" }),
	exceptionType: t.int({
		description: "Service exception type (1=added, 2=removed)",
	}),
	dataset: t.string({
		description: "Name of the GTFS dataset this calendar date belongs to",
	}),
});

export type GTFSCalendarDate = Static<typeof gtfsCalendarDateSchema>;
