import { AlephaError } from "alepha";

/**
 * Feature-owned same-project validation. Core never reads a feature's tables.
 */
export class AutomationReferences {
  protected readonly validators = new Map<
    string,
    (projectId: number, value: string | number) => Promise<string | undefined>
  >();
  public register(
    kind: string,
    validate: (
      projectId: number,
      value: string | number,
    ) => Promise<string | undefined>,
  ): void {
    if (this.validators.has(kind))
      throw new AlephaError(
        `Automation reference '${kind}' is registered twice`,
      );
    this.validators.set(kind, validate);
  }
  public async reason(
    kind: string,
    projectId: number,
    value: string | number,
  ): Promise<string | undefined> {
    const validate = this.validators.get(kind);
    return validate
      ? validate(projectId, value)
      : `No module validates '${kind}' references here`;
  }
}
