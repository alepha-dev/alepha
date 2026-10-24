/**
 * The three ids every stack environment endpoint is addressed by.
 */
export interface StackTarget {
  projectId: number;
  stackId: string;
  environmentId: string;
}
