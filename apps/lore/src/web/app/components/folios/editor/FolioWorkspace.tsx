import type { ReactElement } from "react";
import type { Folio } from "@/api/entities/folios.ts";
import FolioWorkspaceContent from "./FolioWorkspaceContent.tsx";
import { useFolioFonts } from "./useFolioFonts.ts";

export interface FolioWorkspaceProps {
  /**
   * `undefined` → create mode. A `Folio` → edit mode.
   */
  folio?: Folio;
  /**
   * Create-mode only: the directory the new folio lands in.
   */
  directoryId?: string;
}

/**
 * The folio workspace — one always-editable surface replacing the old
 * split between a read-only `FolioView` and a separate editor form
 * (`FolioEditor`, mounted at the now-deleted `/edit` route).
 *
 * Three panes: folio tree, document, inspector. This task establishes the
 * shell and the document column; the side panes arrive in later tasks and
 * slot into the marked regions of `FolioWorkspaceContent`.
 *
 * The actual content lives in a child keyed on the folio id. Alepha's
 * router does not remount a page component on a param-only navigation
 * (`ReactPageProvider.createElement` passes no `key`, and `NestedView`
 * renders the resolved element as plain state) — clicking from one folio
 * to another under this same route only re-renders `FolioWorkspace` with
 * new props, it does not tear it down. Without the `key` below,
 * `useFolioDraft`'s `useForm` (whose `FormModel` is cached for the life
 * of its calling component) and its `useFormValues`/`useFormState`
 * subscribers (which bind to that one model once, at mount) would carry
 * the previous folio's buffer over for a frame, and the form's own `id`
 * would never actually change. Keying on the folio id turns a folio
 * switch into a full remount instead, which is the only way to reset all
 * of that state atomically.
 */
const FolioWorkspace = (props: FolioWorkspaceProps): ReactElement => {
  useFolioFonts();

  return (
    <FolioWorkspaceContent
      key={props.folio?.id ?? "new"}
      folio={props.folio}
      directoryId={props.directoryId}
    />
  );
};

export default FolioWorkspace;
