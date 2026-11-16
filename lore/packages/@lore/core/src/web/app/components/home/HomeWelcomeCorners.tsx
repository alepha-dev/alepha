/**
 * Four corner marks framing the welcome page's two bands (the pillars and
 * the features under them), drawn over the band's own rules in a lighter
 * stroke, as a viewfinder frames a shot. The parent must be `relative`; the
 * marks sit on the `max-w-5xl` column the bands' cells are ruled in, so
 * they land on its outer corners.
 */
const HomeWelcomeCorners = () => {
  const mark = "border-foreground/70 absolute size-4";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-full max-w-5xl -translate-x-1/2 md:block"
    >
      <span className={`${mark} top-0 left-0 border-t-2 border-l-2`} />
      <span className={`${mark} top-0 right-0 border-t-2 border-r-2`} />
      <span className={`${mark} bottom-0 left-0 border-b-2 border-l-2`} />
      <span className={`${mark} right-0 bottom-0 border-r-2 border-b-2`} />
    </div>
  );
};

export default HomeWelcomeCorners;
