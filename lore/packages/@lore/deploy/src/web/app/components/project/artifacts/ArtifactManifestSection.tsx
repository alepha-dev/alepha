import type { ReactNode } from "react";

export interface ArtifactManifestSectionProps {
  /**
   * The section's key in the manifest, for the test id.
   */
  name: string;
  title: string;
  children: ReactNode;
}

/**
 * One titled block of the Manifest tab.
 */
const ArtifactManifestSection = (props: ArtifactManifestSectionProps) => (
  <section
    data-testid={`artifact-manifest-${props.name}`}
    className="flex min-w-0 flex-col gap-2"
  >
    <h3 className="text-sm font-medium">{props.title}</h3>
    {props.children}
  </section>
);

export default ArtifactManifestSection;
