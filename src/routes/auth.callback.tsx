import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { initSupabase, isLocalMode } from "~/lib/supabase-client";
import { saveProviderToken } from "~/server/settings";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    if (isLocalMode()) {
      navigate({ to: "/" });
      return;
    }

    let subscription: { unsubscribe: () => void } | undefined;

    initSupabase().then((supabase) => {
      if (!supabase) return;

      const { data } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (event === "SIGNED_IN") {
          if (session?.provider_token) {
            try {
              await saveProviderToken({
                data: { provider: "github", token: session.provider_token },
              });
            } catch {
              // Non-fatal — user can reconnect later from settings
            }
          }
          navigate({ to: "/" });
        }
      });
      subscription = data.subscription;
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-zinc-400">Signing in...</p>
    </div>
  );
}
