import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { deleteUserSession, getSessionUser } from "@/lib/server/user-store";

export const sessionCookieName = "gouwei_session";
export const oauthStateCookieName = "gouwei_oauth_state";
export const sessionMaxAgeSeconds = 30 * 24 * 60 * 60;

function secret() {
  return (
    process.env.AUTH_SESSION_SECRET ||
    process.env.ZHIHU_OAUTH_APP_KEY ||
    process.env.ZHIHU_APP_SECRET ||
    "gouwei-local-dev-secret"
  );
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function verifySignedValue(value?: string) {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return null;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer) ? payload : null;
}

export function createSignedValue(value: string) {
  return `${value}.${sign(value)}`;
}

export function randomState() {
  return randomBytes(24).toString("base64url");
}

export function getSessionIdFromRequest(request: NextRequest) {
  return verifySignedValue(request.cookies.get(sessionCookieName)?.value);
}

export async function requireUser(request: NextRequest) {
  const sessionId = getSessionIdFromRequest(request);
  const user = await getSessionUser(sessionId);
  return user ? { user, sessionId } : null;
}

export async function clearSession(request: NextRequest, response: NextResponse) {
  const sessionId = getSessionIdFromRequest(request);
  await deleteUserSession(sessionId);
  response.cookies.delete(sessionCookieName);
}

function isHttpsRequest(request?: NextRequest) {
  if (!request) {
    return false;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto) {
    return forwardedProto === "https";
  }

  return request.nextUrl.protocol === "https:";
}

export function setSessionCookie(response: NextResponse, sessionId: string, request?: NextRequest) {
  response.cookies.set(sessionCookieName, createSignedValue(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttpsRequest(request),
    path: "/",
    maxAge: sessionMaxAgeSeconds,
  });
}
