import { describe, it } from "vitest";

import { CalculatorEngine } from "../CalculatorEngine.ts";
import type { CalculatorState } from "../CalculatorState.ts";

class TestCalculator extends CalculatorEngine {
  /**
   * Plays a key sequence such as `"12+3="` and returns the display.
   */
  public press(keys: string): string {
    let state: CalculatorState = this.initial();
    for (const key of keys) {
      if (/\d/.test(key)) state = this.digit(state, key);
      else if (key === ".") state = this.dot(state);
      else if (key === "=") state = this.equals(state);
      else if (key === "C") state = this.clear();
      else if (key === "±") state = this.negate(state);
      else if (key === "%") state = this.percent(state);
      else state = this.operator(state, key as "+" | "-" | "×" | "÷");
    }
    return state.display;
  }
}

describe("CalculatorEngine", () => {
  const calc = new TestCalculator();

  it("adds, subtracts, multiplies and divides", ({ expect }) => {
    expect(calc.press("12+3=")).toBe("15");
    expect(calc.press("12-30=")).toBe("-18");
    expect(calc.press("6×7=")).toBe("42");
    expect(calc.press("1÷4=")).toBe("0.25");
  });

  it("applies operators left to right as they are entered", ({ expect }) => {
    expect(calc.press("2+3×4=")).toBe("20");
    expect(calc.press("2+3×")).toBe("5");
  });

  it("hides floating point noise", ({ expect }) => {
    expect(calc.press("0.1+0.2=")).toBe("0.3");
  });

  it("replaces an operator pressed twice", ({ expect }) => {
    expect(calc.press("8+-3=")).toBe("5");
  });

  it("shows Error on a division by zero, and recovers on the next digit", ({
    expect,
  }) => {
    expect(calc.press("5÷0=")).toBe("Error");
    expect(calc.press("5÷0=7")).toBe("7");
  });

  it("keeps one dot and drops a leading zero", ({ expect }) => {
    expect(calc.press("0.5.5")).toBe("0.55");
    expect(calc.press("007")).toBe("7");
  });

  it("negates, takes a percent and clears", ({ expect }) => {
    expect(calc.press("5±")).toBe("-5");
    expect(calc.press("50%")).toBe("0.5");
    expect(calc.press("123C")).toBe("0");
  });

  it("starts a new number after a result", ({ expect }) => {
    expect(calc.press("2+2=9")).toBe("9");
  });
});
