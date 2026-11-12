import { describe, expect, it } from "vitest";
import { splitFigures } from "./num-text.tsx";

describe("splitFigures", () => {
  it("marks amounts and counts, and leaves the words", () => {
    expect(splitFigures("Mobile phone · Singtel: S$48.00 · 1 receipt")).toEqual([
      { text: "Mobile phone · Singtel: ", figure: false },
      { text: "S$48.00", figure: true },
      { text: " · ", figure: false },
      { text: "1", figure: true },
      { text: " receipt", figure: false },
    ]);
  });

  it("keeps thousands separators, negatives and times in one figure", () => {
    expect(
      splitFigures("-S$1,234.50 at 09:30")
        .filter((p) => p.figure)
        .map((p) => p.text),
    ).toEqual(["-S$1,234.50", "09:30"]);
  });

  it("returns plain text untouched", () => {
    expect(splitFigures("No receipt")).toEqual([{ text: "No receipt", figure: false }]);
  });
});
