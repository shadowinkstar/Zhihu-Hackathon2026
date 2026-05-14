import { NextRequest, NextResponse } from "next/server";
import { oauthStateCookieName, sessionMaxAgeSeconds, setSessionCookie } from "@/lib/server/auth";
import { exchangeZhihuCode, fetchZhihuUser, zhihuOAuthConfig } from "@/lib/server/zhihu-oauth";
import {
  consumeOAuthReturnOrigin,
  createLoginTicket,
  createUserSession,
  upsertZhihuUser,
} from "@/lib/server/user-store";

export const runtime = "nodejs";

function callbackError(request: NextRequest, message: string) {
  const config = zhihuOAuthConfig(request.nextUrl.origin);
  const url = new URL("/", config.postLoginOrigin);
  url.searchParams.set("auth_error", message);
  const response = NextResponse.redirect(url);
  response.cookies.delete(oauthStateCookieName);
  return response;
}

export async function GET(request: NextRequest) {
  const authorizationCode =
    request.nextUrl.searchParams.get("authorization_code") ||
    request.nextUrl.searchParams.get("code");
  const allParams = Object.fromEntries(request.nextUrl.searchParams);

  if (!authorizationCode) {
    const reason =
      request.nextUrl.searchParams.get("error_description") ||
      request.nextUrl.searchParams.get("error") ||
      request.nextUrl.searchParams.get("message") ||
      request.nextUrl.searchParams.get("data");
    const detail = Object.keys(allParams).length
      ? `，回调参数：${JSON.stringify(allParams)}`
      : "，回调没有携带任何查询参数";
    return callbackError(request, `知乎授权未返回 code${reason ? `：${reason}` : detail}`);
  }

  try {
    const config = zhihuOAuthConfig(request.nextUrl.origin);
    const token = await exchangeZhihuCode(config.publicOrigin, authorizationCode);
    const profile = await fetchZhihuUser(config.publicOrigin, token);
    const user = await upsertZhihuUser(profile);
    const session = await createUserSession(user.id, sessionMaxAgeSeconds);
    const postLoginOrigin =
      (await consumeOAuthReturnOrigin()) || config.postLoginOrigin;
    const redirectUrl = new URL("/", postLoginOrigin);
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(oauthStateCookieName);
    if (postLoginOrigin === request.nextUrl.origin) {
      setSessionCookie(response, session.id);
    } else {
      const ticket = await createLoginTicket(session.id);
      redirectUrl.searchParams.set("login_ticket", ticket.id);
      response.headers.set("location", redirectUrl.toString());
    }
    return response;
  } catch (error) {
    return callbackError(request, error instanceof Error ? error.message : "知乎登录失败");
  }
}
