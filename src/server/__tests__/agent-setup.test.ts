import { describe, it, expect } from "vitest";
import { validateRepoUrl, repoNameFromUrl } from "../agent-setup";

describe("validateRepoUrl", () => {
  it("accepts github.com URLs", () => {
    expect(validateRepoUrl("https://github.com/user/repo")).toBe(
      "https://github.com/user/repo",
    );
  });

  it("accepts gitlab.com URLs", () => {
    expect(validateRepoUrl("https://gitlab.com/user/repo")).toBe(
      "https://gitlab.com/user/repo",
    );
  });

  it("accepts bitbucket.org URLs", () => {
    expect(validateRepoUrl("https://bitbucket.org/user/repo")).toBe(
      "https://bitbucket.org/user/repo",
    );
  });

  it("prepends https:// if missing", () => {
    expect(validateRepoUrl("github.com/user/repo")).toBe(
      "https://github.com/user/repo",
    );
  });

  it("rejects non-https protocols", () => {
    expect(() => validateRepoUrl("http://github.com/user/repo")).toThrow(
      "must use HTTPS",
    );
  });

  it("rejects unknown hosts", () => {
    expect(() => validateRepoUrl("https://evil.com/user/repo")).toThrow(
      "not allowed",
    );
  });

  it("rejects invalid URLs", () => {
    expect(() => validateRepoUrl("://not-a-url")).toThrow("Invalid");
  });
});

describe("repoNameFromUrl", () => {
  it("extracts repo name from URL", () => {
    expect(repoNameFromUrl("https://github.com/user/my-app")).toBe("my-app");
  });

  it("strips .git suffix", () => {
    expect(repoNameFromUrl("https://github.com/user/my-app.git")).toBe(
      "my-app",
    );
  });

  it("returns workspace for empty path", () => {
    expect(repoNameFromUrl("")).toBe("workspace");
  });
});
