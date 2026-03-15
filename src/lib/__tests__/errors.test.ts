import { describe, it, expect } from "vitest";
import { toErrorMessage } from "../errors";

describe("toErrorMessage", () => {
  it("extracts message from Error instances", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("converts strings directly", () => {
    expect(toErrorMessage("something broke")).toBe("something broke");
  });

  it("converts numbers", () => {
    expect(toErrorMessage(42)).toBe("42");
  });

  it("converts null and undefined", () => {
    expect(toErrorMessage(null)).toBe("null");
    expect(toErrorMessage(undefined)).toBe("undefined");
  });
});
