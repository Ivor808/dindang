import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createBrowserClient } from "@supabase/ssr";
import { useState } from "react";
import { toErrorMessage } from "~/lib/errors";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const supabase = createBrowserClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_ANON_KEY!,
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithOAuth = async (provider: "github" | "google") => {
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: provider === "github" ? "repo" : undefined,
      },
    });
  };

  const signInWithPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        if (authError.message === "Invalid login credentials") {
          // Try signing up instead
          const { error: signUpError } = await supabase.auth.signUp({ email, password });
          if (signUpError) throw signUpError;
        } else {
          throw authError;
        }
      }
      navigate({ to: "/" });
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-bold text-center mb-8">dindang</h1>

        <form onSubmit={signInWithPassword} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-zinc-950 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full px-4 py-3 bg-white text-black hover:bg-zinc-200 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors cursor-pointer"
          >
            {loading ? "..." : "Sign in / Sign up"}
          </button>
        </form>

        {error && <p className="text-red-400 text-xs text-center">{error}</p>}

        <div className="flex items-center gap-3 text-zinc-600 text-xs">
          <div className="flex-1 border-t border-zinc-800" />
          or
          <div className="flex-1 border-t border-zinc-800" />
        </div>

        <button
          onClick={() => signInWithOAuth("github")}
          className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors cursor-pointer"
        >
          Sign in with GitHub
        </button>
        <button
          onClick={() => signInWithOAuth("google")}
          className="w-full px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm transition-colors cursor-pointer"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
