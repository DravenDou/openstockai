import { NextResponse, type NextRequest } from "next/server";
import { isAppRoute } from "@/shell/routes";

// The root layout streams its shell before a page can call notFound(), which would
// leave unknown URLs with HTTP 200. Deciding here returns a real 404 status.
export function proxy(request: NextRequest) {
  if (isAppRoute(request.nextUrl.pathname)) return NextResponse.next();
  return NextResponse.rewrite(new URL("/_not-found", request.url), { status: 404 });
}

export const config = {
  // Pages only: skip API routes, the agent proxy, Next internals and static files.
  matcher: ["/((?!api/|eve/|_next/|.*\\..*).*)"],
};
