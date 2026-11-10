export interface AttachmentHtmlPreviewProps {
  /**
   * The file's own text, already fetched by the viewer.
   */
  html: string;
  /**
   * The file name, as the frame's accessible name.
   */
  title: string;
}

/**
 * An HTML attachment, rendered.
 *
 * ⚠️ The `sandbox` attribute is the whole security argument, and
 * `allow-same-origin` must never join it. The file was uploaded by a member
 * or an agent and is served from Lore's own origin, so running it there
 * would hand it the reader's session. Sandboxed without `allow-same-origin`
 * the document gets an opaque origin: its scripts and styles run, and it
 * has no cookie, no storage and no credentialed call to Lore's API.
 * `allow-scripts` and `allow-same-origin` together would let the frame
 * remove its own sandbox.
 *
 * From `srcDoc`, not from `/api/files/<id>`: the text is already in hand for
 * the Code tab, and a frame navigated to the endpoint would depend on what
 * that endpoint's headers say today.
 *
 * Nothing else is allowed: no forms, popups, top navigation or modals. The
 * file's relative links and assets resolve against Lore, not against its
 * sibling attachments, so they do not load. That is accepted: there is no
 * resolver.
 *
 * White behind it because a page that sets no background assumes one, and
 * the dialog's dark surface showing through made black text unreadable.
 */
const AttachmentHtmlPreview = (props: AttachmentHtmlPreviewProps) => (
  <iframe
    data-testid="attachment-html-preview"
    title={props.title}
    sandbox="allow-scripts"
    srcDoc={props.html}
    className="border-border h-[70vh] w-full rounded-md border bg-white"
  />
);

export default AttachmentHtmlPreview;
