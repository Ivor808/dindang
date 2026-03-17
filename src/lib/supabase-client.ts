import type { SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (import.meta.env.VITE_DINDANG_MODE === "local") return null;
  return _client ?? null;
}

let _initPromise: Promise<SupabaseClient | null> | undefined;

export async function initSupabase(): Promise<SupabaseClient | null> {
  if (import.meta.env.VITE_DINDANG_MODE === "local") return null;

  if (!_initPromise) {
    _initPromise = (async () => {
      const { createBrowserClient } = await import("@supabase/ssr");
      _client = createBrowserClient(
        import.meta.env.VITE_SUPABASE_URL!,
        import.meta.env.VITE_SUPABASE_ANON_KEY!,
      );
      return _client;
    })();
  }

  return _initPromise;
}

export function isLocalMode(): boolean {
  return import.meta.env.VITE_DINDANG_MODE === "local";
}
