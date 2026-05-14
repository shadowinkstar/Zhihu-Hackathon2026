import { NextRequest, NextResponse } from "next/server";
import { saveOAuthReturnOrigin } from "@/lib/server/user-store";
import { buildZhihuAuthorizeUrl, zhihuOAuthConfig } from "@/lib/server/zhihu-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = zhihuOAuthConfig(request.nextUrl.origin);
  const authorizeUrl = buildZhihuAuthorizeUrl(request.nextUrl.origin);
  await saveOAuthReturnOrigin(config.postLoginOrigin);
  return NextResponse.redirect(authorizeUrl);
}
