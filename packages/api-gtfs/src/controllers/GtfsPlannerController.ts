import { $inject, t } from "@alepha/core";
import { $action } from "@alepha/server";
import { GtfsJourneyService } from "../services/GtfsJourneyService.ts";

/**
 * Controller for GTFS journey planning
 */
export class GtfsPlannerController {
	private readonly journeyService = $inject(GtfsJourneyService);

	private readonly url = "/gtfs";
	private readonly group = "gtfs";

	/**
	 * Plan a journey from origin to destination
	 */
	public planJourney = $action({
		path: `${this.url}/journey`,
		method: "POST",
		group: this.group,
		schema: {
			body: t.object({
				dataset: t.optional(
					t.string({
						description: "Dataset name (defaults to first loaded dataset)",
					}),
				),
				origin: t.string({ description: "Origin stop name or ID" }),
				destination: t.string({ description: "Destination stop name or ID" }),
				departureDate: t.string({
					description: "Departure date in YYYYMMDD format",
				}),
				departureTime: t.optional(
					t.string({ description: "Departure time in HH:MM format" }),
				),
				maxResults: t.optional(t.int({ default: 10 })),
			}),
			response: t.object({
				journeys: t.array(
					t.object({
						legs: t.array(
							t.object({
								tripId: t.string(),
								routeId: t.string(),
								routeName: t.string(),
								departureStop: t.string(),
								departureStopName: t.string(),
								departureTime: t.string(),
								arrivalStop: t.string(),
								arrivalStopName: t.string(),
								arrivalTime: t.string(),
								headsign: t.optional(t.string()),
							}),
						),
						totalDuration: t.int({ description: "Total duration in minutes" }),
						departureTime: t.string(),
						arrivalTime: t.string(),
					}),
				),
			}),
		},
		handler: async ({ body }) => {
			const journeys = this.journeyService.planJourney(body.dataset, body);
			return { journeys };
		},
	});
}
