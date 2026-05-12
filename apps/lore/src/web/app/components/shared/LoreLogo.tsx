export interface LoreLogoProps {
  className?: string;
  size?: number;
}

const LoreLogo = (props: LoreLogoProps) => {
  const size = props.size ?? 24;
  return (
    <img
      src="/logo-512x512.png"
      alt="Lore"
      width={size}
      height={size}
      className={props.className ?? "size-6"}
    />
  );
};

export default LoreLogo;
