type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  openid?: string;
  id?: string;
  uid?: string;
  user_id?: string;
  hash_id?: string;
  fullname?: string;
  name?: string;
  nickname?: string;
  avatar_url?: string;
  avatar?: string;
  avatar_path?: string;
  url_token?: string;
  url?: string;
  data?: unknown;
  code?: number;
  [key: string]: unknown;
};

function env(name: string, fallback = "") {
  return process.env[name]?.trim() || fallback;
}

function normalizeOrigin(value: string) {
  return new URL(value).origin;
}

function isUnusablePublicHost(origin: string) {
  const hostname = new URL(origin).hostname;
  return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]";
}

function resolvePublicOrigin(requestOrigin: string) {
  const explicitOrigin = env("ZHIHU_OAUTH_PUBLIC_ORIGIN", env("ZHIHU_OAUTH_POST_LOGIN_ORIGIN"));
  if (explicitOrigin) {
    return normalizeOrigin(explicitOrigin);
  }

  const explicitRedirectUri = env("ZHIHU_OAUTH_REDIRECT_URI");
  if (explicitRedirectUri) {
    return normalizeOrigin(explicitRedirectUri);
  }

  const origin = normalizeOrigin(requestOrigin);
  if (isUnusablePublicHost(origin)) {
    throw new Error("知乎 OAuth 不能使用 0.0.0.0 作为公网回调地址，请配置 ZHIHU_OAUTH_REDIRECT_URI 或 ZHIHU_OAUTH_POST_LOGIN_ORIGIN");
  }
  return origin;
}

export function zhihuOAuthConfig(origin: string) {
  const publicOrigin = resolvePublicOrigin(origin);
  const appId = env("ZHIHU_OAUTH_APP_ID", env("ZHIHU_APP_ID", "312"));
  const appKey = env("ZHIHU_OAUTH_APP_KEY", env("ZHIHU_APP_KEY"));
  const redirectUri = env(
    "ZHIHU_OAUTH_REDIRECT_URI",
    `${publicOrigin}/api/auth/zhihu/callback`,
  );

  return {
    appId,
    appKey,
    publicOrigin,
    redirectUri,
    postLoginOrigin: normalizeOrigin(env("ZHIHU_OAUTH_POST_LOGIN_ORIGIN", publicOrigin)),
    scope: env("ZHIHU_OAUTH_SCOPE"),
    authorizeUrl: env("ZHIHU_OAUTH_AUTHORIZE_URL", "https://openapi.zhihu.com/authorize"),
    tokenUrl: env("ZHIHU_OAUTH_TOKEN_URL", "https://openapi.zhihu.com/access_token"),
    userInfoUrl: env("ZHIHU_OAUTH_USERINFO_URL", "https://openapi.zhihu.com/user"),
  };
}

export function buildZhihuAuthorizeUrl(origin: string) {
  const config = zhihuOAuthConfig(origin);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("app_id", config.appId);
  url.searchParams.set("response_type", "code");
  if (config.scope) {
    url.searchParams.set("scope", config.scope);
  }
  return url;
}

export async function exchangeZhihuCode(origin: string, code: string) {
  const config = zhihuOAuthConfig(origin);
  if (!config.appId || !config.appKey) {
    throw new Error("知乎 OAuth APP_ID 或 APP_KEY 未配置");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    app_id: config.appId,
    app_key: config.appKey,
    redirect_uri: config.redirectUri,
  });

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const token = (await readJson(response)) as TokenResponse;
  const tokenPayload = normalizeZhihuPayload<TokenResponse>(token);
  if (!response.ok || !tokenPayload.access_token) {
    throw new Error(
      typeof token.error === "string"
        ? token.error
        : typeof token.data === "string"
          ? token.data
          : `知乎 OAuth 换取 token 失败：${response.status}`,
    );
  }

  return tokenPayload;
}

export async function fetchZhihuUser(origin: string, token: TokenResponse) {
  const config = zhihuOAuthConfig(origin);
  let profile: TokenResponse = {};

  if (config.userInfoUrl) {
    const response = await fetch(config.userInfoUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token.access_token}`,
      },
    });
    const userPayload = (await readJson(response)) as TokenResponse;
    if (response.ok) {
      profile = normalizeZhihuPayload<TokenResponse>(userPayload);
    }
    if (userPayload.code && userPayload.code !== 200 && typeof userPayload.data === "string") {
      throw new Error(`知乎用户信息获取失败：${userPayload.data}`);
    }
  }

  const source = { ...token, ...profile };
  const zhihuId = String(
    source.uid ||
      source.id ||
      source.user_id ||
      source.hash_id ||
      source.openid ||
      source.url_token ||
      "",
  );
  if (!zhihuId) {
    throw new Error("知乎 OAuth 没有返回可识别的用户 ID");
  }

  return {
    zhihuId,
    name: String(source.fullname || source.name || source.nickname || source.hash_id || "知乎用户"),
    avatarUrl:
      typeof source.avatar_path === "string"
        ? source.avatar_path
        : typeof source.avatar_url === "string"
          ? source.avatar_url
          : typeof source.avatar === "string"
            ? source.avatar
            : undefined,
    urlToken:
      typeof source.hash_id === "string"
        ? source.hash_id
        : typeof source.url_token === "string"
          ? source.url_token
          : undefined,
  };
}

function normalizeZhihuPayload<T>(payload: TokenResponse) {
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) {
    return payload.data as T;
  }
  return payload as T;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}
