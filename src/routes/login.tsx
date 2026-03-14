import { createFileRoute } from "@tanstack/react-router";
import { createBrowserClient } from "@supabase/ssr";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const supabase = createBrowserClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_ANON_KEY!,
  );

  const signIn = async (provider: "github" | "google") => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: provider === "github" ? "repo" : undefined,
      },
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center mb-8">dindang</h1>
        <button
          onClick={() => signIn("github")}
          className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors cursor-pointer"
        >
          Sign in with GitHub
        </button>
        <button
          onClick={() => signIn("google")}
          className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors cursor-pointer"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
