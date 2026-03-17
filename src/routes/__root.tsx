import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { initSupabase, isLocalMode } from "~/lib/supabase-client";
import type { SupabaseClient } from "@supabase/supabase-js";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
});

function RootError({ error }: { error: Error }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>dindang - error</title>
        <HeadContent />
      </head>
      <body className="bg-zinc-950 text-zinc-100 font-mono min-h-screen flex items-center justify-center" suppressHydrationWarning>
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-bold text-red-400">Something went wrong</h1>
          <p className="text-sm text-zinc-400">{error.message}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors cursor-pointer"
            >
              retry
            </button>
            <a
              href="/login"
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded text-xs transition-colors"
            >
              back to login
            </a>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const [user, setUser] = useState<any>(isLocalMode() ? {} : null);
  const [loading, setLoading] = useState(!isLocalMode());
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (isLocalMode()) return;

    initSupabase().then((client) => {
      if (!client) return;
      setSupabase(client);

      client.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        setLoading(false);
      });
      const {
        data: { subscription },
      } = client.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });
      return () => subscription.unsubscribe();
    });
  }, []);

  const isPublicRoute =
    location.pathname === "/login" || location.pathname === "/auth/callback";

  useEffect(() => {
    if (!loading && !user && !isPublicRoute) {
      navigate({ to: "/login" });
    }
  }, [loading, user, isPublicRoute, navigate]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>dindang</title>
        <HeadContent />
      </head>
      <body className="bg-zinc-950 text-zinc-100 font-mono min-h-screen" suppressHydrationWarning>
        {!loading && (
          <>
            <nav className="border-b border-zinc-800 px-6 py-3 flex items-center justify-between">
              <Link to="/" className="text-sm font-bold hover:text-zinc-300">
                dindang
              </Link>
              {user && (
                <div className="flex items-center gap-3">
                  <Link
                    to="/settings"
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    settings
                  </Link>
                  {!isLocalMode() && (
                    <>
                      <span className="text-xs text-zinc-500">{user.email}</span>
                      <button
                        onClick={() => supabase?.auth.signOut()}
                        className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
                      >
                        sign out
                      </button>
                    </>
                  )}
                </div>
              )}
            </nav>
            <Outlet />
          </>
        )}
        <Scripts />
      </body>
    </html>
  );
}
