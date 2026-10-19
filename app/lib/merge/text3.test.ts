import { describe, expect, it } from "vitest";
import { mergeText2, mergeText3, renderMergedText, renderWithMarkers, splitLines } from "./text3";
import { lineDiff } from "./lineDiff";

const base = ["<head>", "  {{ content_for_header }}", "</head>", "<body>", "  {{ content_for_layout }}", "</body>", ""].join("\n");

describe("splitLines", () => {
  it("round-trips text exactly", () => {
    for (const t of ["", "a", "a\n", "a\nb", "a\r\nb\r\n"]) expect(splitLines(t).join("")).toBe(t);
  });
});

describe("mergeText3", () => {
  it("auto-merges non-overlapping edits", () => {
    const live = base.replace("<head>", "<head>\n  <script src=\"client-tracking.js\"></script>");
    const target = base.replace("  {{ content_for_layout }}", "  {% render 'new-header' %}\n  {{ content_for_layout }}");
    const result = mergeText3(base, live, target);
    expect(result.conflictCount).toBe(0);
    const merged = renderMergedText(result.regions, {});
    expect(merged).toContain("client-tracking.js");
    expect(merged).toContain("new-header");
  });

  it("reports conflicts on overlapping edits and honours decisions", () => {
    const live = base.replace("</head>", "  <meta name=\"client\">\n</head>");
    const target = base.replace("</head>", "  <meta name=\"dev\">\n</head>");
    const result = mergeText3(base, live, target);
    expect(result.conflictCount).toBe(1);
    expect(renderMergedText(result.regions, {})).toContain("dev");
    expect(renderMergedText(result.regions, { 0: "left" })).toContain("client");
    const both = renderMergedText(result.regions, { 0: "left-then-right" });
    expect(both.indexOf("client")).toBeLessThan(both.indexOf("dev"));
    expect(renderWithMarkers(result.regions, { left: "live", right: "target" })).toMatch(/<<<<<<< live[\s\S]*=======[\s\S]*>>>>>>> target/);
  });

  it("treats identical changes on both sides as no conflict", () => {
    const changed = base.replace("<body>", "<body class=\"x\">");
    expect(mergeText3(base, changed, changed).conflictCount).toBe(0);
  });
});

describe("mergeText2", () => {
  it("turns every differing hunk into a decision", () => {
    const live = base.replace("<body>", "<body class=\"live\">");
    const target = base.replace("</body>", "  <footer></footer>\n</body>");
    const result = mergeText2(live, target);
    expect(result.conflictCount).toBe(2);
    const picked = renderMergedText(result.regions, { 0: "left", 1: "right" });
    expect(picked).toContain("class=\"live\"");
    expect(picked).toContain("<footer>");
  });
});

describe("lineDiff", () => {
  it("produces add/del rows with collapsed context", () => {
    const a = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const b = a.replace("line 10", "line ten");
    const rows = lineDiff(a, b, 2);
    expect(rows.filter((r) => r.type === "add")).toHaveLength(1);
    expect(rows.filter((r) => r.type === "del")).toHaveLength(1);
    expect(rows[0]).toEqual({ type: "skip", count: 8 });
  });
});
