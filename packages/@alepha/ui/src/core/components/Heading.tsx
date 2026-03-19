import SectionHeader, { type SectionHeaderProps } from "./SectionHeader.tsx";

export type HeadingProps = SectionHeaderProps;

/**
 * Alias for SectionHeader.
 *
 * @deprecated Use `SectionHeader` instead.
 */
const Heading = (props: HeadingProps) => {
  return <SectionHeader {...props} />;
};

export default Heading;
