import { AlephaError } from "alepha";

/**
 * Feature-owned same-project validation. Core never reads a feature's tables.
 */
export class AutomationReferences {
  protected readonly optionProviders = new Map<
    string,
    AutomationReferenceOptionProvider
  >();
  public registerOptions(
    kind: string,
    provider: AutomationReferenceOptionProvider,
  ): void {
    if (this.optionProviders.has(kind))
      throw new AlephaError(
        `Automation options '${kind}' are already registered`,
      );
    this.optionProviders.set(kind, provider);
  }
  public options(kind: string): AutomationReferenceOptionProvider | undefined {
    return this.optionProviders.get(kind);
  }

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

export interface AutomationReferenceOptionProvider {
  permission: string;
  read: (input: {
    projectId: number;
    offset: number;
    limit: number;
    /**
     * Case-insensitive text the label must contain, as typed.
     */
    search?: string;
    /**
     * Exact values to resolve; when present the page holds only these.
     */
    ids?: string[];
  }) => Promise<{
    items: Array<{ value: string; label: string }>;
    hasMore: boolean;
  }>;
}
