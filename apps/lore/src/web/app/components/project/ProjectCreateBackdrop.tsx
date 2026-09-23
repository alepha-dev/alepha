/**
 * The new-project page's backdrop: the drifting lattice and the two pools of
 * primary, drawn by `.lore-create-backdrop` in `main.css`.
 *
 * Sits at `z-index: -1`, so the parent must be `relative isolate` or the
 * layer escapes behind the page's own background.
 */
const ProjectCreateBackdrop = () => {
  return (
    <div aria-hidden="true" className="lore-create-backdrop">
      <div className="lore-create-backdrop-lattice" />
    </div>
  );
};

export default ProjectCreateBackdrop;
