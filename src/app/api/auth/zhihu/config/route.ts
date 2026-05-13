import { NextRequest, NextResponse } from "next/server";
import { zhihuOAuthConfig } from "@/lib/server/zhihu-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = zhihuOAuthConfig(request.nextUrl.origin);
  return NextResponse.json({
    appId: config.appId,
    redirectUri: config.redirectUri,
    scope: config.scope,
  });
}
