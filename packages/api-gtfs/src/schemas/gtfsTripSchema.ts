import { type Static, t } from "@alepha/core";

/**
 * GTFS Trip entity schema
 */
export const gtfsTripSchema = t.object({
	tripId: t.string({ description: "Unique identifier for a trip" }),
	routeId: t.string({ description: "Route identifier" }),
	serviceId: t.string({
		description: "Service identifier that indicates when service is available",
	}),
	tripHeadsign: t.optional(
		t.string({
			description:
				"Text that appears to riders identifying the trip's destination",
		}),
	),
	tripShortName: t.optional(
		t.string({ description: "Short name to identify the trip to riders" }),
	),
	directionId: t.optional(
		t.int({ description: "Direction of travel (0 or 1)" }),
	),
	blockId: t.optional(t.string({ description: "Block identifier" })),
	shapeId: t.optional(t.string({ description: "Shape identifier" })),
	wheelchairAccessible: t.optional(
		t.int({
			description:
				"Wheelchair accessibility (0=unknown, 1=accessible, 2=not accessible)",
		}),
	),
	bikesAllowed: t.optional(
		t.int({
			description: "Bikes allowed (0=unknown, 1=allowed, 2=not allowed)",
		}),
	),
	dataset: t.string({
		description: "Name of the GTFS dataset this trip belongs to",
	}),
});

export type GTFSTrip = Static<typeof gtfsTripSchema>;
