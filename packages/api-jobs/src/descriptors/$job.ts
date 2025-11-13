import { $inject, createDescriptor, Descriptor, KIND } from "@alepha/core";
import type { DateTime } from "@alepha/datetime";
import { type Job, JobProvider } from "../providers/JobProvider.ts";

/**
 * Job descriptor - a drop-in replacement for $scheduler with built-in execution tracking.
 */
export const $job = (options: JobDescriptorOptions): JobDescriptor => {
  return createDescriptor(JobDescriptor, options);
};

// ---------------------------------------------------------------------------------------------------------------------

export type JobDescriptorOptions = Omit<Job, "name"> & {
  /**
   * Name of the job. Defaults to the descriptor property name.
   */
  name?: string;
};

// ---------------------------------------------------------------------------------------------------------------------

export class JobDescriptor extends Descriptor<JobDescriptorOptions> {
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

  public async trigger(): Promise<void> {
    await this.jobProvider.triggerJob(this.name);
  }
}

$job[KIND] = JobDescriptor;

// ---------------------------------------------------------------------------------------------------------------------

export interface JobHandlerArguments {
  now: DateTime;
}
