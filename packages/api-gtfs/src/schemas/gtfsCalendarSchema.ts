import { type Static, t } from "@alepha/core";

/**
 * GTFS Calendar entity schema
 */
export const gtfsCalendarSchema = t.object({
	serviceId: t.string({ description: "Service identifier" }),
	monday: t.int({ description: "Service operates on Mondays (1=yes, 0=no)" }),
	tuesday: t.int({ description: "Service operates on Tuesdays (1=yes, 0=no)" }),
	wednesday: t.int({
		description: "Service operates on Wednesdays (1=yes, 0=no)",
	}),
	thursday: t.int({
		description: "Service operates on Thursdays (1=yes, 0=no)",
	}),
	friday: t.int({ description: "Service operates on Fridays (1=yes, 0=no)" }),
	saturday: t.int({
		description: "Service operates on Saturdays (1=yes, 0=no)",
	}),
	sunday: t.int({ description: "Service operates on Sundays (1=yes, 0=no)" }),
	startDate: t.string({ description: "Start date in YYYYMMDD format" }),
	endDate: t.string({ description: "End date in YYYYMMDD format" }),
	dataset: t.string({
		description: "Name of the GTFS dataset this calendar belongs to",
	}),
});

export type GTFSCalendar = Static<typeof gtfsCalendarSchema>;
