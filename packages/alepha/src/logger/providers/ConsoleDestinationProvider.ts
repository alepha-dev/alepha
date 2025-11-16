import { LogDestinationProvider } from "./LogDestinationProvider.ts";

export class ConsoleDestinationProvider extends LogDestinationProvider {
  public write(message: string): void {
    console.log(message);
  }
}
