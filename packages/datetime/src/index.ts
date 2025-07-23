import { $module } from "@alepha/core";
import { $interval } from "./descriptors/$interval.ts";
import { DateTimeProvider } from "./providers/DateTimeProvider.ts";

export * from "./descriptors/$interval.ts";
export * from "./providers/DateTimeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaDateTime = $module({
	name: "alepha.datetime",
	descriptors: [$interval],
	services: [DateTimeProvider],
});
