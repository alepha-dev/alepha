import { Showcase } from "@/web/components/Showcase.tsx";

/**
 * `/blocks/overlays/panel` loaded by its URL: the full page. The same path
 * reached from a link on `/blocks/overlays` opens `OverlayPanelSheet`
 * instead, over that page.
 */
const OverlayPanelPage = () => (
  <Showcase
    id="blocks/OverlayPanelPage"
    title="Panel"
    description="An overlay route, rendered in full because it was loaded by its URL."
    center
  >
    {() => (
      <p className="text-sm">
        Opened from the Overlays page, this same URL is a sheet over it.
      </p>
    )}
  </Showcase>
);

export default OverlayPanelPage;
