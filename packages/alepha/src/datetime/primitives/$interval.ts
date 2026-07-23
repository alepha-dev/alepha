import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import {
  DateTimeProvider,
  type DurationLike,
} from "../providers/DateTimeProvider.ts";

/**
 * Run a function periodically.
 * It uses the `setInterval` internally.
 * It starts by default when the context starts and stops when the context stops.
 */
export const $interval = (options: IntervalPrimitiveOptions) =>
  createPrimitive(IntervalPrimitive, options);

// ---------------------------------------------------------------------------------------------------------------------

export interface IntervalPrimitiveOptions {
  /**
   * The interval handler.
   */
  handler: () => unknown;

  /**
   * The interval duration.
   */
  duration: DurationLike;
}

// ---------------------------------------------------------------------------------------------------------------------

export class IntervalPrimitive extends Primitive<IntervalPrimitiveOptions> {
  protected readonly dateTimeProvider = $inject(DateTimeProvider);

  public called = 0;

  protected onInit() {
    this.dateTimeProvider.createInterval(async () => {
      try {
        await this.options.handler();
      } catch (error) {
        // A throwing tick must not become an unhandled rejection that kills
        // the process — log it and let the next tick run.
        this.alepha.log?.error("Interval handler failed", error);
      }
      this.called += 1;
    }, this.options.duration);
  }
}

$interval[KIND] = IntervalPrimitive;
