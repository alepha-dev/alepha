import { IconArrowRight } from "@tabler/icons-react";
import { useState } from "react";
import { runtimeTargets } from "../../config/runtimes.ts";

const RuntimeSwitcher = () => {
  const [active, setActive] = useState(0);
  const target = runtimeTargets[active];
  const ActiveIcon = target.icon;

  return (
    <div className="runtime-layout">
      {/* Left: the switch and the description */}
      <div className="runtime-left">
        <div className="runtime-tabs" role="tablist" aria-label="Deploy target">
          {runtimeTargets.map((it, index) => {
            const Icon = it.icon;
            return (
              <button
                key={it.key}
                type="button"
                role="tab"
                aria-selected={active === index}
                onClick={() => setActive(index)}
                className={`runtime-tab${active === index ? " is-active" : ""}`}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{it.label}</span>
              </button>
            );
          })}
        </div>

        <div className="runtime-detail" key={target.key}>
          <h3 className="runtime-headline">
            <ActiveIcon size={22} aria-hidden="true" />
            {target.headline}
          </h3>
          <p className="runtime-description">{target.description}</p>
        </div>
      </div>

      {/* Right: the comparison */}
      <div className="runtime-right">
        <div className="runtime-table">
          <div className="runtime-row runtime-row-head">
            <span>You write this</span>
            <span aria-hidden="true" />
            <span>It runs on this</span>
          </div>
          {target.bindings.map((binding) => (
            <div className="runtime-row" key={binding.primitive}>
              <code className="runtime-primitive">{binding.primitive}</code>
              <IconArrowRight size={14} className="runtime-arrow" />
              <span className="runtime-impl" key={target.key}>
                {binding.impl}
              </span>
            </div>
          ))}
        </div>

        <p className="runtime-footnote">
          The left column is your source code. It is byte for byte identical on
          all three. Nothing is ported, nothing is conditionally imported.
        </p>

        <div className="runtime-command">
          <span className="runtime-command-prompt">{">_"}</span>
          <code>{target.command}</code>
        </div>
      </div>
    </div>
  );
};

export default RuntimeSwitcher;
