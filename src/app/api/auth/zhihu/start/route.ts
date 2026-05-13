import { NextRequest, NextResponse } from "next/server";
import { saveOAuthReturnOrigin } from "@/lib/server/user-store";
import { buildZhihuAuthorizeUrl } from "@/lib/server/zhihu-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  await saveOAuthReturnOrigin(request.nextUrl.origin);
  const authorizeUrl = buildZhihuAuthorizeUrl(request.nextUrl.origin);
  return NextResponse.json({ authorizeUrl: authorizeUrl.toString() });
}
