import { $module } from "@alepha/core";
import { $interval } from "./descriptors/$interval.ts";
import { DateTimeProvider } from "./providers/DateTimeProvider.ts";

export * from "./descriptors/$interval.ts";
export * from "./helpers/Interval.ts";
export * from "./helpers/Timeout.ts";
export * from "./providers/DateTimeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const AlephaDateTime = $module({
	name: "alepha.datetime",
	descriptors: [$interval],
	services: [DateTimeProvider],
});

export default AlephaDateTime;
