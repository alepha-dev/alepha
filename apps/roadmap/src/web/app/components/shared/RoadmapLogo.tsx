export interface RoadmapLogoProps {
  className?: string;
  size?: number;
}

const RoadmapLogo = (props: RoadmapLogoProps) => {
  const size = props.size ?? 24;
  return (
    <img
      src="/logo-512x512.png"
      alt="Roadmap"
      width={size}
      height={size}
      className={props.className ?? "size-6"}
    />
  );
};

export default RoadmapLogo;
