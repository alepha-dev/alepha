import { type Static, t } from "@alepha/core";

/**
 * GTFS Stop entity schema
 */
export const gtfsStopSchema = t.object({
	stopId: t.string({ description: "Unique identifier for a stop" }),
	stopCode: t.optional(
		t.string({
			description: "Short text or number that identifies the stop for riders",
		}),
	),
	stopName: t.string({ description: "Name of the stop" }),
	stopDesc: t.optional(t.string({ description: "Description of the stop" })),
	stopLat: t.number({ description: "Latitude of the stop" }),
	stopLon: t.number({ description: "Longitude of the stop" }),
	zoneId: t.optional(t.string({ description: "Fare zone for a stop" })),
	stopUrl: t.optional(
		t.string({ description: "URL of a web page about the stop" }),
	),
	locationType: t.optional(
		t.int({ description: "Type of location (0=stop, 1=station)" }),
	),
	parentStation: t.optional(
		t.string({ description: "Parent station identifier" }),
	),
	stopTimezone: t.optional(t.string({ description: "Timezone of the stop" })),
	wheelchairBoarding: t.optional(
		t.int({
			description:
				"Wheelchair accessibility (0=unknown, 1=accessible, 2=not accessible)",
		}),
	),
	dataset: t.string({
		description: "Name of the GTFS dataset this stop belongs to",
	}),
});

export type GTFSStop = Static<typeof gtfsStopSchema>;
