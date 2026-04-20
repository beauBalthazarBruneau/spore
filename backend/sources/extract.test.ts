import { describe, it, expect } from "vitest";
import { extractSalaryFromText, extractRemoteFromText } from "./extract";

describe("extractSalaryFromText", () => {
  it("extracts $X,XXX - $Y,YYY range", () => {
    const r = extractSalaryFromText("The salary range is $130,000 - $180,000 per year.");
    expect(r.min).toBe(130000);
    expect(r.max).toBe(180000);
    expect(r.range).toBeTruthy();
  });

  it("extracts standalone $X,XXX", () => {
    const r = extractSalaryFromText("Base compensation starts at $150,000.");
    expect(r.min).toBe(150000);
  });

  it("extracts $XXXK format", () => {
    const r = extractSalaryFromText("Compensation: $150K-$200K");
    expect(r.min).toBe(150000);
    expect(r.max).toBe(200000);
  });

  it("ignores small dollar amounts", () => {
    expect(extractSalaryFromText("We raised $5 million in funding")).toEqual({});
    expect(extractSalaryFromText("Save $50 per month")).toEqual({});
  });

  it("returns empty for no description", () => {
    expect(extractSalaryFromText(undefined)).toEqual({});
  });

  it("returns empty when no salary present", () => {
    expect(extractSalaryFromText("Great job with amazing benefits")).toEqual({});
  });
});

describe("extractRemoteFromText", () => {
  it("detects 'fully remote'", () => {
    expect(extractRemoteFromText("This is a fully remote position")).toBe("remote");
  });

  it("detects 'remote' standalone", () => {
    expect(extractRemoteFromText("Location: Remote")).toBe("remote");
  });

  it("detects 'hybrid'", () => {
    expect(extractRemoteFromText("This role is hybrid, 3 days in office")).toBe("hybrid");
  });

  it("detects 'on-site'", () => {
    expect(extractRemoteFromText("This is an on-site role in NYC")).toBe("onsite");
  });

  it("detects 'in-office'", () => {
    expect(extractRemoteFromText("Must work in-office 5 days a week")).toBe("onsite");
  });

  it("returns undefined when no signal", () => {
    expect(extractRemoteFromText("Great engineering role")).toBeUndefined();
  });

  it("returns undefined for no description", () => {
    expect(extractRemoteFromText(undefined)).toBeUndefined();
  });
});
