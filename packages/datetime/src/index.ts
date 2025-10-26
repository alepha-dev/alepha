import { $module } from "@alepha/core";
import { $interval } from "./descriptors/$interval.ts";
import { DateTimeProvider } from "./providers/DateTimeProvider.ts";
import type {
  date,
  datetime,
  duration,
  isDateSchema,
  isDateTimeSchema,
  isDurationSchema,
  isTimeSchema,
  time,
} from "./providers/DateTimeTypeProvider.ts";

export * from "./descriptors/$interval.ts";
export * from "./providers/DateTimeProvider.ts";
export * from "./providers/DateTimeTypeProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

declare module "@alepha/core" {
  interface TypeProvider {
    datetime: typeof datetime;
    date: typeof date;
    time: typeof time;
    duration: typeof duration;
  }
  interface TypeGuard {
    isDateTime: typeof isDateTimeSchema;
    isDate: typeof isDateSchema;
    isTime: typeof isTimeSchema;
    isDuration: typeof isDurationSchema;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaDateTime = $module({
  name: "alepha.datetime",
  descriptors: [$interval],
  services: [DateTimeProvider],
});
