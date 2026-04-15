import { describe, it, expect } from "vitest";
import { BOARD_COLUMNS, BOARD_SIDE, SWIPE_STATUS } from "./types";

describe("board status configuration", () => {
  it("includes fetched and new at the front of the board so unscored and approved jobs are visible", () => {
    expect(BOARD_COLUMNS.slice(0, 2)).toEqual(["fetched", "new"]);
  });

  it("keeps swipe pinned to the 'new' status", () => {
    expect(SWIPE_STATUS).toBe("new");
  });

  it("does not duplicate any status across the main and side columns", () => {
    const all = [...BOARD_COLUMNS, ...BOARD_SIDE];
    expect(new Set(all).size).toBe(all.length);
  });
});
