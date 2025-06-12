export * from "./descriptors/$interval.ts";
export * from "./helpers/Timeout.ts";
export * from "./helpers/Interval.ts";
export * from "./providers/DateTimeProvider.ts";
export { DateTime } from "luxon";
import type {
	Duration as LuxonDuration,
	DurationLike as LuxonDurationLike,
} from "luxon";

export type DurationLike = LuxonDurationLike;
export type Duration = LuxonDuration;
