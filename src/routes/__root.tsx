import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  component: RootLayout,
  head: () => ({
    links: [{ rel: "stylesheet", href: appCss }],
  }),
});

function RootLayout() {
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
          <Link
            to="/settings"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            settings
          </Link>
        </nav>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
