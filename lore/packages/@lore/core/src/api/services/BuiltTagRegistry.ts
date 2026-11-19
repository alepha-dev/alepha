/**
 * Which commits a project built, by tag: Ship's artifacts, read by Build's
 * Quality report to place each tag on its coverage curve (#E162). Neither
 * package may import the other, so Ship registers here and Build asks.
 *
 * A project with Ship off, or a build without Ship, has no source and reads
 * no tag: the curve simply has no tag marks.
 */
export class BuiltTagRegistry {
  protected readonly sources: BuiltTagSource[] = [];

  public register(source: BuiltTagSource): void {
    this.sources.push(source);
  }

  /**
   * Every tag the project built, with its commit when one was recorded.
   */
  public async tagsOf(projectId: number): Promise<BuiltTag[]> {
    const read = await Promise.all(
      this.sources.map((source) => source(projectId)),
    );
    return read.flat();
  }
}

export type BuiltTagSource = (projectId: number) => Promise<BuiltTag[]>;

export interface BuiltTag {
  tag: string;
  commitSha?: string;
}
