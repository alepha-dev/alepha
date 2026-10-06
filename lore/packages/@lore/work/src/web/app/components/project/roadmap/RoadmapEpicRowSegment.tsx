export interface RoadmapEpicRowSegmentProps {
  count: number;
  className: string;
}

/**
 * One bucket of an epic's tick bar.
 *
 * `flex: {count}` rather than a percentage width, so the four segments divide
 * the track between themselves and cannot fail to add up to it, whatever the
 * counts are. Same mechanism as `ReleaseProgressBar`, and for the same
 * reason.
 *
 * A zero bucket renders nothing at all rather than a hairline: an epic with
 * no shelved work should not carry a sliver suggesting there is some.
 */
const RoadmapEpicRowSegment = (props: RoadmapEpicRowSegmentProps) => {
  if (props.count <= 0) return null;
  return (
    <span
      style={{ flex: props.count }}
      className={`rounded-[1px] ${props.className}`}
    />
  );
};

export default RoadmapEpicRowSegment;
