import { type Static, t } from "@alepha/core";

/**
 * GTFS StopTime entity schema
 */
export const gtfsStopTimeSchema = t.object({
	tripId: t.string({ description: "Trip identifier" }),
	arrivalTime: t.string({ description: "Arrival time in HH:MM:SS format" }),
	departureTime: t.string({ description: "Departure time in HH:MM:SS format" }),
	stopId: t.string({ description: "Stop identifier" }),
	stopSequence: t.int({ description: "Order of stops for a particular trip" }),
	stopHeadsign: t.optional(
		t.string({
			description:
				"Text that appears to riders identifying the trip's destination",
		}),
	),
	pickupType: t.optional(
		t.int({
			description: "Pickup method (0=regular, 1=none, 2=phone, 3=driver)",
		}),
	),
	dropOffType: t.optional(
		t.int({
			description: "Drop off method (0=regular, 1=none, 2=phone, 3=driver)",
		}),
	),
	shapeDistTraveled: t.optional(
		t.number({ description: "Distance traveled along shape from first stop" }),
	),
	timepoint: t.optional(
		t.int({ description: "Whether times are exact (1) or approximate (0)" }),
	),
	dataset: t.string({
		description: "Name of the GTFS dataset this stop time belongs to",
	}),
});

export type GTFSStopTime = Static<typeof gtfsStopTimeSchema>;
