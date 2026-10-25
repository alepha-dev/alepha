import type { CalculatorState } from "./CalculatorState.ts";

/**
 * The arithmetic of a pocket calculator, as pure transitions from one state to
 * the next: the page keeps the state, the engine never holds any.
 *
 * Operators apply left to right as they are entered (`2 + 3 × 4 = 20`), the
 * way a four-function calculator does, not by precedence.
 */
export class CalculatorEngine {
  /**
   * Significant digits a result keeps, so `0.1 + 0.2` shows `0.3`.
   */
  protected readonly precision = 12;

  /**
   * Longest entry the display accepts.
   */
  protected readonly maxDigits = 12;

  public initial(): CalculatorState {
    return { display: "0", stored: null, operator: null, fresh: true };
  }

  public digit(state: CalculatorState, digit: string): CalculatorState {
    if (state.display === "Error" || state.fresh) {
      return { ...this.reset(state), display: digit, fresh: false };
    }
    if (state.display.replace(/[-.]/g, "").length >= this.maxDigits) {
      return state;
    }
    const display = state.display === "0" ? digit : state.display + digit;
    return { ...state, display };
  }

  public dot(state: CalculatorState): CalculatorState {
    if (state.display === "Error" || state.fresh) {
      return { ...this.reset(state), display: "0.", fresh: false };
    }
    if (state.display.includes(".")) {
      return state;
    }
    return { ...state, display: `${state.display}.` };
  }

  public operator(
    state: CalculatorState,
    operator: NonNullable<CalculatorState["operator"]>,
  ): CalculatorState {
    if (state.display === "Error") {
      return state;
    }
    // A second operator in a row replaces the first.
    if (state.fresh && state.operator) {
      return { ...state, operator };
    }
    const value = this.pending(state);
    if (value === null) {
      return this.error();
    }
    return {
      display: this.format(value),
      stored: value,
      operator,
      fresh: true,
    };
  }

  public equals(state: CalculatorState): CalculatorState {
    if (state.display === "Error" || !state.operator) {
      return state;
    }
    const value = this.pending(state);
    if (value === null) {
      return this.error();
    }
    return {
      display: this.format(value),
      stored: null,
      operator: null,
      fresh: true,
    };
  }

  public clear(): CalculatorState {
    return this.initial();
  }

  public negate(state: CalculatorState): CalculatorState {
    if (state.display === "Error" || state.display === "0") {
      return state;
    }
    const display = state.display.startsWith("-")
      ? state.display.slice(1)
      : `-${state.display}`;
    return { ...state, display };
  }

  public percent(state: CalculatorState): CalculatorState {
    if (state.display === "Error") {
      return state;
    }
    return { ...state, display: this.format(Number(state.display) / 100) };
  }

  /**
   * The stored value combined with the one on display, or the display alone
   * when nothing is stored. `null` for a division by zero.
   */
  protected pending(state: CalculatorState): number | null {
    const current = Number(state.display);
    if (state.stored === null || !state.operator) {
      return current;
    }
    switch (state.operator) {
      case "+":
        return state.stored + current;
      case "-":
        return state.stored - current;
      case "×":
        return state.stored * current;
      case "÷":
        return current === 0 ? null : state.stored / current;
    }
  }

  protected format(value: number): string {
    return String(Number(value.toPrecision(this.precision)));
  }

  protected reset(state: CalculatorState): CalculatorState {
    return state.display === "Error" ? this.initial() : state;
  }

  protected error(): CalculatorState {
    return { display: "Error", stored: null, operator: null, fresh: true };
  }
}
