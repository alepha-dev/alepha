export * from "./descriptors/$interval.ts";
export * from "./helpers/Timeout.ts";
export * from "./helpers/Interval.ts";
export * from "./providers/DateTimeProvider.ts";
import type {
	DateTime as LuxonDateTime,
	Duration as LuxonDuration,
	DurationLike as LuxonDurationLike,
} from "luxon";

export type DurationLike = LuxonDurationLike;
export type DateTime = LuxonDateTime;
export type Duration = LuxonDuration;
