export interface LoreLogoProps {
  className?: string;
  size?: number;
}

const LoreLogo = (props: LoreLogoProps) => {
  const size = props.size ?? 24;
  const className = props.className ?? "size-6";
  return (
    <>
      <img
        src="/logo-512x512-light.png"
        alt="Lore"
        width={size}
        height={size}
        className={`${className} dark:hidden`}
      />
      <img
        src="/logo-512x512.png"
        alt="Lore"
        width={size}
        height={size}
        className={`${className} hidden dark:block`}
      />
    </>
  );
};

export default LoreLogo;
