import { HapticsProvider } from "@alepha/capacitor";
import { useInject } from "alepha/react";
import { useState } from "react";

import { CalculatorEngine } from "../services/CalculatorEngine.ts";
import type { CalculatorState } from "../services/CalculatorState.ts";

/**
 * The whole app: a display and a keypad. Every press is a state transition
 * from `CalculatorEngine`, nothing leaves the device, and a press taps the
 * phone's haptics (a no-op in a browser).
 */
const Calculator = () => {
  const engine = useInject(CalculatorEngine);
  const haptics = useInject(HapticsProvider);
  const [state, setState] = useState<CalculatorState>(() => engine.initial());

  const press = (next: (current: CalculatorState) => CalculatorState) => {
    void haptics.impact("light");
    setState(next);
  };

  const key = (
    label: string,
    onPress: (current: CalculatorState) => CalculatorState,
    tone: "digit" | "function" | "operator" = "digit",
    wide = false,
  ) => {
    const active =
      tone === "operator" && state.fresh && state.operator === label;
    const tones = {
      digit: "bg-muted text-foreground active:bg-muted-foreground/30",
      function: "bg-secondary text-secondary-foreground active:opacity-70",
      operator: active
        ? "bg-primary-foreground text-primary ring-2 ring-primary"
        : "bg-primary text-primary-foreground active:opacity-70",
    };
    return (
      <button
        key={label}
        type="button"
        aria-label={label}
        onClick={() => press(onPress)}
        className={`h-18 rounded-full text-3xl font-medium transition select-none ${tones[tone]} ${wide ? "col-span-2 pl-7 text-left" : ""}`}
      >
        {label}
      </button>
    );
  };

  const digit = (d: string, wide = false) =>
    key(d, (s) => engine.digit(s, d), "digit", wide);
  const op = (o: NonNullable<CalculatorState["operator"]>) =>
    key(o, (s) => engine.operator(s, o), "operator");

  const size =
    state.display.length > 9
      ? "text-5xl"
      : state.display.length > 6
        ? "text-6xl"
        : "text-7xl";

  return (
    <div className="pt-safe pb-safe px-safe bg-background flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-end gap-4 p-4">
        <output
          aria-live="polite"
          data-testid="display"
          className={`truncate px-2 text-right font-light tabular-nums ${size}`}
        >
          {state.display}
        </output>
        <div className="grid grid-cols-4 gap-3">
          {key("C", () => engine.clear(), "function")}
          {key("±", (s) => engine.negate(s), "function")}
          {key("%", (s) => engine.percent(s), "function")}
          {op("÷")}
          {digit("7")}
          {digit("8")}
          {digit("9")}
          {op("×")}
          {digit("4")}
          {digit("5")}
          {digit("6")}
          {op("-")}
          {digit("1")}
          {digit("2")}
          {digit("3")}
          {op("+")}
          {digit("0", true)}
          {key(".", (s) => engine.dot(s))}
          {key("=", (s) => engine.equals(s), "operator")}
        </div>
      </div>
    </div>
  );
};

export default Calculator;
