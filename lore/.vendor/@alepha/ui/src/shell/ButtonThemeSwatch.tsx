import * as React from "react";

void React;

export interface ButtonThemeSwatchProps {
  colors: string[];
}

export const ButtonThemeSwatch = (props: ButtonThemeSwatchProps) => {
  return (
    <div className="border-border grid size-6 shrink-0 grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-sm border bg-white p-px">
      {props.colors.slice(0, 4).map((c, i) => (
        <span
          key={i}
          className="block rounded-[1px]"
          style={{ background: c }}
        />
      ))}
    </div>
  );
};
