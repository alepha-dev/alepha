import type { ComponentType } from "react";

/**
 * Components `DialogProvider` draws beside its own dialogs, registered by
 * the modules that own them.
 *
 * The seam that keeps `core` importing no other module: the settings kit
 * registers its `SettingsDialogHost` here when a settings dialog is declared,
 * and every `DialogProvider` (the outermost one, when they nest) draws it.
 * An application that declares nothing never creates this service, and its
 * providers draw nothing extra.
 */
export class DialogHosts {
  protected readonly hosts = new Set<ComponentType>();

  public register(host: ComponentType): void {
    this.hosts.add(host);
  }

  public list(): ComponentType[] {
    return [...this.hosts];
  }
}
