export type DindangMode = "local" | "hosted";

export function getMode(): DindangMode {
  const mode = process.env.DINDANG_MODE || "local";
  if (mode !== "local" && mode !== "hosted") {
    throw new Error(`Invalid DINDANG_MODE: ${mode}. Must be "local" or "hosted".`);
  }
  return mode;
}

export function isLocalMode(): boolean {
  return getMode() === "local";
}
