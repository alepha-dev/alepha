export interface ArtifactStatProps {
  label: string;
  value: string;
  hint?: string;
}

/**
 * One number on the plate, with what it is measured against under it.
 */
const ArtifactStat = (props: ArtifactStatProps) => (
  <div className="bg-muted/40 flex flex-col rounded-md border px-3 py-2">
    <span className="text-muted-foreground text-xs">{props.label}</span>
    <span className="text-lg font-medium tabular-nums">{props.value}</span>
    {props.hint && (
      <span className="text-muted-foreground text-xs">{props.hint}</span>
    )}
  </div>
);

export default ArtifactStat;
