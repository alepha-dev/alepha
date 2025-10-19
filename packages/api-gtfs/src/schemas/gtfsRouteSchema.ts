import { type Static, t } from "@alepha/core";

/**
 * GTFS Route entity schema
 */
export const gtfsRouteSchema = t.object({
	routeId: t.string({ description: "Unique identifier for a route" }),
	agencyId: t.optional(t.string({ description: "Agency identifier" })),
	routeShortName: t.optional(
		t.string({ description: "Short name of the route" }),
	),
	routeLongName: t.optional(
		t.string({ description: "Full name of the route" }),
	),
	routeDesc: t.optional(t.string({ description: "Description of the route" })),
	routeType: t.int({
		description:
			"Type of transportation (0=tram, 1=subway, 2=rail, 3=bus, etc.)",
	}),
	routeUrl: t.optional(
		t.string({ description: "URL of a web page about the route" }),
	),
	routeColor: t.optional(
		t.string({ description: "Route color designation as hex value" }),
	),
	routeTextColor: t.optional(
		t.string({
			description: "Legible color for text on route color background",
		}),
	),
	routeSortOrder: t.optional(
		t.int({ description: "Orders routes for presentation" }),
	),
	dataset: t.string({
		description: "Name of the GTFS dataset this route belongs to",
	}),
});

export type GTFSRoute = Static<typeof gtfsRouteSchema>;
