/**
 * The required asterisk after a field label or a group title (#Q3426).
 *
 * One small fixed gap (`ms-1`), as if the label read `Name *`: the label sits
 * in a flex row whose gap pushed a field's asterisk 10px away, while a group
 * title's sat at 2px. Wrap the label text and this mark in one inline span so
 * no container gap reaches between them.
 */
export const FormFieldRequiredMark = () => (
  <span className="text-danger-text ms-1" aria-hidden>
    *
  </span>
);
