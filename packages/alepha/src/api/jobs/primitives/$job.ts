import { $inject, createPrimitive, KIND, Primitive } from "alepha";
import {
  type Job,
  JobProvider,
  type JobTriggerContext,
} from "../providers/JobProvider.ts";

/**
 * Job primitive - a drop-in replacement for $scheduler with built-in execution tracking.
 */
export const $job = (options: JobPrimitiveOptions): JobPrimitive => {
  return createPrimitive(JobPrimitive, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type JobPrimitiveOptions = Omit<Job, "name"> & {
  /**
   * Name of the job. Defaults to the primitive property name.
   */
  name?: string;
};

// ---------------------------------------------------------------------------------------------------------------------

export class JobPrimitive extends Primitive<JobPrimitiveOptions> {
  protected readonly jobProvider = $inject(JobProvider);

  public get name(): string {
    return (
      this.options.name ??
      `${this.config.service.name}.${this.config.propertyKey}`
    );
  }

  protected onInit() {
    // Register job with JobProvider
    this.jobProvider.registerJob({
      ...this.options,
      name: this.name,
    });
  }

  public async trigger(context?: JobTriggerContext): Promise<void> {
    await this.jobProvider.triggerJob(this.name, context);
  }
}

$job[KIND] = JobPrimitive;
