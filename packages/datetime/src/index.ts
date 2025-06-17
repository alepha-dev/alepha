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

export const isDurationLike = (value: unknown): value is DurationLike => {
	return (
		typeof value === "object" &&
		value !== null &&
		("years" in value ||
			"months" in value ||
			"weeks" in value ||
			"days" in value ||
			"hours" in value ||
			"minutes" in value ||
			"seconds" in value ||
			"milliseconds" in value)
	);
};
