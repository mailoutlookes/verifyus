// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

// server/db.ts
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
});
var logs = mysqlTable("logs", {
  id: int("id").autoincrement().primaryKey(),
  apiToken: varchar("apiToken", { length: 255 }).notNull(),
  // Token usado
  email: varchar("email", { length: 320 }).notNull(),
  // E-mail gerado
  password: varchar("password", { length: 255 }).notNull(),
  // Senha gerada
  createdAt: timestamp("createdAt").defaultNow().notNull()
  // Data de criação
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }
  try {
    const values = {
      openId: user.openId
    };
    const updateSet = {};
    const textFields = ["name", "email", "loginMethod"];
    const assignNullable = (field) => {
      const value = user[field];
      if (value === void 0) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== void 0) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== void 0) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }
    if (!values.lastSignedIn) {
      values.lastSignedIn = /* @__PURE__ */ new Date();
    }
    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = /* @__PURE__ */ new Date();
    }
    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return void 0;
  }
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : void 0;
}
async function insertLog(log) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot insert log: database not available");
    return;
  }
  try {
    await db.insert(logs).values(log);
  } catch (error) {
    console.error("[Database] Failed to insert log:", error);
  }
}
async function getAllLogs() {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get logs: database not available");
    throw new Error("Banco de dados n\xE3o configurado. Logs indispon\xEDveis.");
  }
  try {
    const result = await db.select().from(logs).orderBy(logs.createdAt);
    return result;
  } catch (error) {
    console.error("[Database] Failed to get all logs:", error);
    throw new Error("Erro ao acessar o banco de dados. Verifique a migra\xE7\xE3o.");
  }
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    const redirectUri = atob(state);
    return redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    const sessionCookie = cookies.get(COOKIE_NAME);
    const session = await this.verifySession(sessionCookie);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionCookie ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { z as z2 } from "zod";
import axios2 from "axios";
async function getAccessTokenFromRefreshToken(refreshToken, clientId) {
  try {
    console.log("[OAuth] Requesting access token from Microsoft...");
    const response = await axios2.post(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "https://graph.microsoft.com/.default"
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 1e4
      }
    );
    console.log("[OAuth] Access token obtained successfully");
    return response.data.access_token;
  } catch (error) {
    const axiosError = error;
    const errorData = axiosError.response?.data;
    console.error("[OAuth] Error details:", {
      status: axiosError.response?.status,
      error: errorData?.error,
      description: errorData?.error_description
    });
    if (errorData?.error === "invalid_grant") {
      throw new Error("Refresh token inv\xE1lido ou expirado. Tente gerar um novo e-mail.");
    } else if (errorData?.error === "invalid_client") {
      throw new Error("ID do cliente inv\xE1lido. Verifique os dados do e-mail gerado.");
    } else if (errorData?.error_description) {
      throw new Error(`Erro OAuth: ${errorData.error_description}`);
    }
    throw new Error("Falha ao obter access token do Outlook");
  }
}
function extractVerificationCode(text2) {
  if (!text2) return null;
  console.log(`[Extract] Searching in text (length: ${text2.length})`);
  const keywordPatterns = [
    /(?:your\s+)?(?:verification\s+)?code[:\s]+([0-9]{6})/i,
    /verification[:\s]+([0-9]{6})/i,
    /verify(?:ing)?\s+code[:\s]+([0-9]{6})/i,
    /code\s+(?:is|:)\s+([0-9]{6})/i,
    /6[:\s\-]*digit[:\s\-]+code[:\s]+([0-9]{6})/i,
    /enter[:\s]+([0-9]{6})/i
  ];
  for (const pattern of keywordPatterns) {
    const match = text2.match(pattern);
    if (match && match[1]) {
      console.log(`[Extract] \u2713 Found code with keyword pattern: ${match[1]}`);
      return match[1];
    }
  }
  const allMatches = text2.match(/(?<!#)\b\d{6}\b/g);
  if (allMatches && allMatches.length > 0) {
    const uniqueCodes = Array.from(new Set(allMatches));
    for (const code of uniqueCodes) {
      const codeIndex = text2.indexOf(code);
      const contextStart = Math.max(0, codeIndex - 150);
      const contextEnd = Math.min(text2.length, codeIndex + 150);
      const context = text2.substring(contextStart, contextEnd).toLowerCase();
      const verificationKeywords = [
        "code",
        "verification",
        "verify",
        "confirm",
        "authenticate",
        "enter",
        "use",
        "6-digit",
        "six digit",
        "6 digit"
      ];
      const keywordCount = verificationKeywords.filter((kw) => context.includes(kw)).length;
      if (keywordCount >= 2) {
        console.log(`[Extract] \u2713 Found code in STRONG verification context (${keywordCount} keywords): ${code}`);
        return code;
      }
      if (keywordCount === 1) {
        console.log(`[Extract] ? Found code with weak context (${keywordCount} keyword): ${code} - SKIPPING`);
      }
    }
    console.log(`[Extract] \u2717 Found ${uniqueCodes.length} codes but NONE in strong verification context`);
    return null;
  }
  console.log(`[Extract] \u2717 No 6-digit code found in text`);
  return null;
}
async function listEmailsFromFolders(accessToken, folderIds, limit = 15) {
  try {
    console.log(`[List] Fetching emails from folders: ${folderIds.join(", ")}...`);
    let allMessages = [];
    for (const folderId of folderIds) {
      const response = await axios2.get(
        `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: {
            $top: limit,
            // Limita a busca em cada pasta
            $orderby: "receivedDateTime desc",
            $select: "id,subject,from,receivedDateTime,bodyPreview,body"
          },
          timeout: 1e4
        }
      );
      allMessages = allMessages.concat(response.data.value || []);
    }
    allMessages.sort((a, b) => {
      return new Date(b.receivedDateTime).getTime() - new Date(a.receivedDateTime).getTime();
    });
    const finalMessages = allMessages.slice(0, limit);
    console.log(`[List] Found ${finalMessages.length} emails (combined from ${folderIds.length} folders)`);
    return finalMessages.map((msg) => ({
      id: msg.id,
      subject: msg.subject || "(sem assunto)",
      from: msg.from?.emailAddress?.address || "desconhecido",
      receivedDateTime: msg.receivedDateTime || "",
      bodyPreview: msg.bodyPreview || "",
      body: msg.body?.content || ""
    }));
  } catch (error) {
    console.error("[List] Error fetching emails:", error);
    throw new Error("Erro ao listar e-mails");
  }
}
async function listInboxEmails(accessToken, limit = 15) {
  const foldersToSearch = ["inbox", "deleteditems", "junkemail"];
  return listEmailsFromFolders(accessToken, foldersToSearch, limit);
}
async function searchMessagesInFolder(accessToken, folderId, folderName) {
  try {
    console.log(`[Search] Searching in ${folderName}...`);
    const response = await axios2.get(
      `https://graph.microsoft.com/v1.0/me/mailFolders/${folderId}/messages`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          $top: 30,
          $orderby: "receivedDateTime desc",
          $select: "id,subject,bodyPreview,body,from,receivedDateTime"
        },
        timeout: 1e4
      }
    );
    const messages = response.data.value || [];
    console.log(`[Search] Found ${messages.length} messages in ${folderName}`);
    for (const message of messages) {
      const bodyText = message.body?.content || message.bodyPreview || "";
      if (bodyText) {
        console.log(`[Search] Checking message in ${folderName}: "${message.subject}"`);
        const code = extractVerificationCode(bodyText);
        if (code) {
          console.log(`[Search] \u2713 Verification code found in ${folderName}: ${code}`);
          return code;
        }
      }
    }
    return null;
  } catch (error) {
    console.error(`[Search] Error searching ${folderName}:`, error);
    return null;
  }
}
async function monitorInboxForCode(accessToken, maxAttempts = 60, delayMs = 2e3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      console.log(`[Inbox] Checking for verification code (attempt ${attempt + 1}/${maxAttempts})`);
      let code = await searchMessagesInFolder(accessToken, "inbox", "Inbox");
      if (code) return code;
      code = await searchMessagesInFolder(accessToken, "deleteditems", "Deleted Items");
      if (code) return code;
      code = await searchMessagesInFolder(accessToken, "junkemail", "Junk Email");
      if (code) return code;
      if (attempt < maxAttempts - 1) {
        const waitTime = delayMs + attempt * 100;
        console.log(`[Inbox] Waiting ${waitTime}ms before next check...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    } catch (error) {
      const axiosError = error;
      console.error("[Inbox] Error checking messages:", {
        status: axiosError.response?.status,
        message: axiosError.message
      });
      if (axiosError.response?.status === 401) {
        throw new Error("Sess\xE3o expirada. Tente gerar um novo e-mail.");
      } else if (axiosError.response?.status === 403) {
        throw new Error("Permiss\xE3o negada. Verifique suas credenciais do Outlook.");
      }
      throw new Error("Erro ao monitorar caixa de entrada");
    }
  }
  return null;
}
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true
      };
    })
  }),
  outlook: router({
    // Generate email via apishop.biz API
    generateEmail: publicProcedure.input(z2.object({
      token: z2.string(),
      type: z2.enum(["outlook", "hotmail"]).default("outlook")
    })).mutation(async ({ input }) => {
      try {
        console.log(`[API] Requesting ${input.type} email from apishop.biz...`);
        const response = await axios2.get(
          `https://apishop.biz/api/buy?type=${input.type}&tokens=${input.token}`,
          { timeout: 1e4 }
        );
        if (!response.data.success) {
          let errorMessage = response.data.message || "Erro ao gerar e-mail";
          if (errorMessage.toLowerCase().includes("no balance")) {
            errorMessage = "Saldo insuficiente na sua conta apishop.biz. Por favor, adicione cr\xE9ditos.";
          } else if (errorMessage.toLowerCase().includes("invalid token")) {
            errorMessage = "Token inv\xE1lido. Verifique seu token da API apishop.biz.";
          } else if (errorMessage.toLowerCase().includes("token expired")) {
            errorMessage = "Token expirado. Por favor, gere um novo token.";
          } else if (errorMessage.toLowerCase().includes("no stock")) {
            errorMessage = "Sem estoque dispon\xEDvel para este tipo. Tente o outro tipo (Outlook/Hotmail).";
          }
          console.log("[API] Error:", errorMessage);
          return {
            success: false,
            message: errorMessage,
            result: []
          };
        }
        console.log("[API] Email generated successfully");
        const emailData = response.data.result[0];
        if (!emailData || !emailData.email || !emailData.password) {
          throw new Error("API retornou dados de e-mail incompletos.");
        }
        await insertLog({
          apiToken: input.token,
          email: emailData.email,
          password: emailData.password
        });
        return {
          success: true,
          message: response.data.message,
          result: response.data.result
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Erro desconhecido ao processar a API.";
        console.error("[API] Connection error:", errorMsg);
        return {
          success: false,
          message: `Erro ao conectar com apishop.biz: ${errorMsg}`,
          result: []
        };
      }
    }),
    // Get access token from refresh token
    getAccessToken: publicProcedure.input(
      z2.object({
        refreshToken: z2.string(),
        clientId: z2.string()
      })
    ).mutation(async ({ input }) => {
      try {
        if (!input.refreshToken || input.refreshToken.length < 10) {
          return {
            success: false,
            message: "Refresh token inv\xE1lido ou incompleto",
            accessToken: ""
          };
        }
        if (!input.clientId || input.clientId.length < 10) {
          return {
            success: false,
            message: "Client ID inv\xE1lido ou incompleto",
            accessToken: ""
          };
        }
        const accessToken = await getAccessTokenFromRefreshToken(
          input.refreshToken,
          input.clientId
        );
        return {
          success: true,
          accessToken
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Erro ao conectar ao Outlook";
        console.error("[OAuth] Mutation error:", errorMessage);
        return {
          success: false,
          message: errorMessage,
          accessToken: ""
        };
      }
    }),
    // Monitor inbox and find verification code
    monitorInbox: publicProcedure.input(z2.object({ accessToken: z2.string() })).mutation(async ({ input }) => {
      try {
        if (!input.accessToken || input.accessToken.length < 10) {
          return {
            success: false,
            message: "Access token inv\xE1lido ou incompleto",
            verificationCode: ""
          };
        }
        console.log("[Monitor] Starting inbox monitoring...");
        const verificationCode = await monitorInboxForCode(input.accessToken);
        if (!verificationCode) {
          console.log("[Monitor] No verification code found");
          return {
            success: false,
            message: "C\xF3digo de verifica\xE7\xE3o n\xE3o encontrado. Verifique se o e-mail chegou e cont\xE9m um c\xF3digo de 6 d\xEDgitos.",
            verificationCode: ""
          };
        }
        console.log("[Monitor] Verification code extracted successfully");
        return {
          success: true,
          message: "C\xF3digo de verifica\xE7\xE3o encontrado com sucesso!",
          verificationCode
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Erro ao monitorar caixa de entrada";
        console.error("[Monitor] Error:", errorMessage);
        return {
          success: false,
          message: errorMessage,
          verificationCode: ""
        };
      }
    }),
    // Retry monitoring without generating new email
    retryMonitorInbox: publicProcedure.input(z2.object({ accessToken: z2.string() })).mutation(async ({ input }) => {
      try {
        if (!input.accessToken || input.accessToken.length < 10) {
          return {
            success: false,
            message: "Access token inv\xE1lido ou incompleto",
            verificationCode: ""
          };
        }
        console.log("[Retry] Retrying inbox monitoring...");
        const verificationCode = await monitorInboxForCode(input.accessToken);
        if (!verificationCode) {
          console.log("[Retry] No verification code found");
          return {
            success: false,
            message: "C\xF3digo de verifica\xE7\xE3o n\xE3o encontrado. Tente novamente em alguns momentos.",
            verificationCode: ""
          };
        }
        console.log("[Retry] Verification code extracted successfully");
        return {
          success: true,
          message: "C\xF3digo de verifica\xE7\xE3o encontrado com sucesso!",
          verificationCode
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Erro ao monitorar caixa de entrada";
        console.error("[Retry] Error:", errorMessage);
        return {
          success: false,
          message: errorMessage,
          verificationCode: ""
        };
      }
    }),
    // List all logs
    listLogs: publicProcedure.input(z2.void()).mutation(async () => {
      try {
        const logs2 = await getAllLogs();
        return {
          success: true,
          message: `${logs2.length} logs encontrados`,
          logs: logs2
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Erro ao listar logs";
        console.error("[ListLogs] Error:", errorMessage);
        return {
          success: false,
          message: errorMessage,
          logs: []
        };
      }
    }),
    // List emails from inbox
    listEmails: publicProcedure.input(z2.object({ accessToken: z2.string() })).mutation(async ({ input }) => {
      try {
        if (!input.accessToken || input.accessToken.length < 10) {
          return {
            success: false,
            message: "Access token inv\xE1lido",
            emails: []
          };
        }
        console.log("[ListEmails] Fetching emails...");
        const emails = await listInboxEmails(input.accessToken);
        return {
          success: true,
          message: `${emails.length} e-mails encontrados`,
          emails
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Erro ao listar e-mails";
        console.error("[ListEmails] Error:", errorMessage);
        return {
          success: false,
          message: errorMessage,
          emails: []
        };
      }
    })
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
