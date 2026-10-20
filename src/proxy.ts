import { NextResponse } from "next/server";

/**
 * Kumihimo has no Server Actions. Any request carrying a Next-Action header is refused before
 * routing, on every path including /api and paths with dots (cross-project lesson).
 */
export function proxy(): NextResponse {
  return new NextResponse(null, { status: 403 });
}

export const config = {
  matcher: [
    {
      source: "/:path*",
      has: [{ type: "header", key: "next-action" }],
    },
  ],
};
