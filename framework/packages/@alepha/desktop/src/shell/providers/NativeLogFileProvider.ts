import { LogFileProvider } from "./LogFileProvider.ts";

/**
 * {@link LogFileProvider} with `dup2`.
 */
export class NativeLogFileProvider extends LogFileProvider {
  public async redirect(file: string): Promise<void> {
    const { Descriptors } = await import("../native/Descriptors.ts");
    new Descriptors().redirectOutput(file);
  }
}
