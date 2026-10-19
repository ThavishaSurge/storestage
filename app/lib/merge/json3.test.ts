import { describe, expect, it } from "vitest";
import { applyDecisions, merge3 } from "./json3";

describe("merge3", () => {
  it("takes the changed side when only one side changed", () => {
    const base = { a: 1, b: 2 };
    expect(merge3(base, { a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({ value: { a: 1, b: 3 }, conflicts: [] });
    expect(merge3(base, { a: 5, b: 2 }, { a: 1, b: 2 })).toEqual({ value: { a: 5, b: 2 }, conflicts: [] });
  });

  it("merges independent key edits from both sides", () => {
    const base = { sections: { hero: { settings: { title: "Hi", color: "red" } } } };
    const live = { sections: { hero: { settings: { title: "Hello", color: "red" } } } };
    const target = { sections: { hero: { settings: { title: "Hi", color: "blue" } } } };
    const { value, conflicts } = merge3(base, live, target);
    expect(conflicts).toEqual([]);
    expect(value).toEqual({ sections: { hero: { settings: { title: "Hello", color: "blue" } } } });
  });

  it("reports a conflict when both sides change the same leaf", () => {
    const { value, conflicts } = merge3({ t: "a" }, { t: "live" }, { t: "target" });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ id: "t", left: "live", right: "target", base: "a", kind: "value" });
    expect(value).toEqual({ t: "target" });
  });

  it("handles adds and deletes of keys", () => {
    const base = { sections: { a: { type: "x" }, b: { type: "y" } } };
    const live = { sections: { a: { type: "x" }, b: { type: "y" }, c: { type: "client" } } };
    const target = { sections: { a: { type: "x" }, d: { type: "dev" } } };
    const { value, conflicts } = merge3(base, live, target);
    expect(conflicts).toEqual([]);
    expect(value).toEqual({ sections: { a: { type: "x" }, d: { type: "dev" }, c: { type: "client" } } });
  });

  it("flags delete-vs-modify", () => {
    const base = { sections: { b: { type: "y", v: 1 } } };
    const live = { sections: { b: { type: "y", v: 2 } } };
    const target = { sections: {} };
    const { conflicts } = merge3(base, live, target);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("delete-modify");
    expect(conflicts[0].id).toBe("sections.b");
  });

  it("merges ordered sets like a template order array", () => {
    const base = { order: ["hero", "text", "footer"] };
    const live = { order: ["hero", "client", "text", "footer"] };
    const target = { order: ["hero", "text", "dev", "footer"] };
    const { value, conflicts } = merge3(base, live, target);
    expect(conflicts).toEqual([]);
    expect(value).toEqual({ order: ["hero", "client", "text", "dev", "footer"] });
  });

  it("applies removals from either side in ordered sets", () => {
    const { value } = merge3({ order: ["a", "b", "c"] }, { order: ["a", "c"] }, { order: ["a", "b", "c", "d"] });
    expect(value).toEqual({ order: ["a", "c", "d"] });
  });

  it("reports order conflicts when both sides re-order differently", () => {
    const { conflicts } = merge3({ order: ["a", "b", "c"] }, { order: ["c", "a", "b"] }, { order: ["b", "a", "c"] });
    expect(conflicts.map((c) => c.kind)).toEqual(["order"]);
  });

  it("works without a base (union of additions, conflicts on differing leaves)", () => {
    const { value, conflicts } = merge3(undefined, { a: 1, l: true }, { a: 2, r: true });
    expect(value).toEqual({ a: 2, r: true, l: true });
    expect(conflicts.map((c) => c.id)).toEqual(["a"]);
  });

  it("applies decisions, including deletes", () => {
    const base = { s: { b: { v: 1 } }, t: "a" };
    const live = { s: { b: { v: 2 } }, t: "live" };
    const target = { s: {}, t: "target" };
    const { value, conflicts } = merge3(base, live, target);
    const decided = applyDecisions(value, conflicts, { "s.b": "right", t: "left" });
    expect(decided).toEqual({ s: {}, t: "live" });
    const kept = applyDecisions(value, conflicts, { "s.b": "left", t: { custom: "both" } });
    expect(kept).toEqual({ s: { b: { v: 2 } }, t: "both" });
  });
});
