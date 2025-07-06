import {
	$inject,
	Alepha,
	type TBoolean,
	type TNumber,
	type TObject,
	type TString,
	t,
} from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { $route, type RouteDescriptor } from "@alepha/server";

/**
 * Register `/health` endpoint.
 *
 * - Provides basic health information about the server.
 */
export class ServerHealthProvider {
	protected readonly time: DateTimeProvider = $inject(DateTimeProvider);
	protected readonly alepha: Alepha = $inject(Alepha);

	public readonly health: RouteDescriptor<{
		response: TObject<{
			message: TString;
			uptime: TNumber;
			date: TString;
			ready: TBoolean;
		}>;
	}> = $route({
		path: "/health",
		schema: {
			response: t.object({
				message: t.string(),
				uptime: t.number(),
				date: t.datetime(),
				ready: t.boolean(),
			}),
		},
		silent: true,
		handler: () => ({
			message: "OK",
			uptime: Math.floor(process.uptime()),
			date: this.time.nowISOString(),
			ready: this.alepha.isReady(),
		}),
	});
}
