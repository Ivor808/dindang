import {
  createRootRoute,
  HeadContent,
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
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
