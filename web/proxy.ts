import { NextResponse, type NextRequest } from "next/server";

// Vercel's own deployment protection (SSO/password) isn't available for
// production deployments on the Hobby plan (confirmed live via the
// Projects API: "Vercel Authentication is not available on your plan for
// production deployments"), so this is the app-level substitute: a single
// shared password (SITE_PASSWORD, set as a Vercel env var, never
// committed) gates every request via a cookie. Not meant to withstand a
// determined attacker -- just keeps the deployment from being casually
// public, per explicit instruction not to leave it open.
const COOKIE_NAME = "site-auth";

export function proxy(request: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next(); // no password configured -- don't lock everyone out

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (cookie === password) return NextResponse.next();

  const url = request.nextUrl.searchParams.get("password");
  if (url === password) {
    const res = NextResponse.redirect(new URL(request.nextUrl.pathname, request.url));
    res.cookies.set(COOKIE_NAME, password, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
    return res;
  }

  return new NextResponse(
    `<!doctype html><html><body style="font-family:system-ui;max-width:24rem;margin:4rem auto;padding:0 1rem">
      <h1 style="font-size:1.1rem">Password required</h1>
      <form method="GET">
        <input type="password" name="password" placeholder="Password" autofocus style="width:100%;padding:.5rem;margin-bottom:.5rem" />
        <button type="submit" style="width:100%;padding:.5rem">Enter</button>
      </form>
    </body></html>`,
    { status: 401, headers: { "content-type": "text/html" } },
  );
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};
