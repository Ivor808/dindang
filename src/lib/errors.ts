export function toErrorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Strip null bytes and non-printable control chars (except newline/tab)
  // that cause PostgreSQL "invalid byte sequence" errors
  return msg.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
