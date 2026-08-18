export interface AdminShotProps {
  base: string;
  label: string;
  className?: string;
}

/**
 * One admin screenshot, in both themes.
 *
 * The swap is CSS rather than `<picture media="(prefers-color-scheme)">`,
 * because this site's theme is an explicit `data-theme` on the root element: a
 * media query would ignore the header toggle and show a light screenshot to
 * someone who just chose dark.
 */
const AdminShot = (props: AdminShotProps) => {
  return (
    <>
      <img
        src={`${props.base}-light.png`}
        alt={`Alepha admin panel: ${props.label}`}
        className={`admin-shot admin-shot-light ${props.className ?? ""}`}
        width={1680}
        height={1000}
        loading="lazy"
      />
      <img
        src={`${props.base}-dark.png`}
        alt=""
        aria-hidden="true"
        className={`admin-shot admin-shot-dark ${props.className ?? ""}`}
        width={1680}
        height={1000}
        loading="lazy"
      />
    </>
  );
};

export default AdminShot;
