import { describe, it, expect } from "vitest";
import { randomName } from "../names";

describe("randomName", () => {
  it("returns adjective-noun-number format", () => {
    const name = randomName();
    expect(name).toMatch(/^[a-z]+-[a-z]+-\d+$/);
  });

  it("number is 0-99", () => {
    for (let i = 0; i < 50; i++) {
      const num = parseInt(randomName().split("-")[2]!, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThan(100);
    }
  });

  it("generates different names (not always identical)", () => {
    const names = new Set(Array.from({ length: 20 }, () => randomName()));
    expect(names.size).toBeGreaterThan(1);
  });
});
