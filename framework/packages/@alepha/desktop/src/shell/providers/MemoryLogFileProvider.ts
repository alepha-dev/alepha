import { LogFileProvider } from "./LogFileProvider.ts";

/**
 * {@link LogFileProvider} for specs: records the redirects, and fails when
 * {@link failure} is set.
 */
export class MemoryLogFileProvider extends LogFileProvider {
  public redirects: string[] = [];
  public failure?: Error;

  public async redirect(file: string): Promise<void> {
    if (this.failure) {
      throw this.failure;
    }
    this.redirects.push(file);
  }
}
