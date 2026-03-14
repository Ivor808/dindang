import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { createBrowserClient } from "@supabase/ssr";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const supabase = createBrowserClient(
      import.meta.env.VITE_SUPABASE_URL!,
      import.meta.env.VITE_SUPABASE_ANON_KEY!,
    );

    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        navigate({ to: "/" });
      }
    });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-zinc-400">Signing in...</p>
    </div>
  );
}
