import { describe, expect, it } from "vitest";

import { emptyHistory, pushHistory, redoHistory, undoHistory } from "./history";

describe("history", () => {
  it("undoes and redoes in order", () => {
    let h = emptyHistory<number>();
    h = pushHistory(h, 0);
    h = pushHistory(h, 1);
    const u1 = undoHistory(h, 2)!;
    expect(u1.state).toBe(1);
    const u2 = undoHistory(u1.history, u1.state)!;
    expect(u2.state).toBe(0);
    expect(undoHistory(u2.history, u2.state)).toBeNull();
    const r1 = redoHistory(u2.history, u2.state)!;
    expect(r1.state).toBe(1);
    expect(redoHistory(r1.history, r1.state)!.state).toBe(2);
  });

  it("clears redo on a new edit and caps the past", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 10; i++) h = pushHistory(h, i, 5);
    expect(h.past).toEqual([5, 6, 7, 8, 9]);
    const u = undoHistory(h, 10)!;
    expect(pushHistory(u.history, 9).future).toEqual([]);
  });
});
