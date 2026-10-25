export interface WorkshopTask {
  orderId: string;
  itemId: string;
  leadDays: number;
}

/**
 * Stand-in for whatever actually tells the workshop to get to work.
 *
 * In-memory on purpose: this demo exists to prove the extension point, and a
 * real implementation would be a `$job` writing to a table.
 */
export class WorkshopQueue {
  public readonly tasks: WorkshopTask[] = [];

  public enqueue(task: WorkshopTask): void {
    this.tasks.push(task);
  }
}
