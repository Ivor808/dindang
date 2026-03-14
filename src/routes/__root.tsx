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
import { createBrowserClient } from "@supabase/ssr";
import appCss from "../styles.css?url";

const supabase = createBrowserClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_ANON_KEY!,
);

export const Route = createRootRoute({
  component: RootLayout,
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
});

function RootLayout() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const isPublicRoute =
    location.pathname === "/login" || location.pathname === "/auth/callback";

  useEffect(() => {
    if (!loading && !user && !isPublicRoute) {
      navigate({ to: "/login" });
    }
  }, [loading, user, isPublicRoute, navigate]);

  if (loading) {
    return (
      <html lang="en">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>dindang</title>
          <HeadContent />
        </head>
        <body className="bg-zinc-950 text-zinc-100 font-mono min-h-screen" />
      </html>
    );
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>dindang</title>
        <HeadContent />
      </head>
      <body className="bg-zinc-950 text-zinc-100 font-mono min-h-screen">
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
              <span className="text-xs text-zinc-500">{user.email}</span>
              <button
                onClick={() => supabase.auth.signOut()}
                className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                sign out
              </button>
            </div>
          )}
        </nav>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
