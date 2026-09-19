import { Config } from "@/config/config"
import { EffectBridge } from "@/effect/bridge"
import { Provider } from "@/provider/provider"
import { Admin, type Credentials } from "@/server/admin"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import type { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Effect } from "effect"
import { HttpEffect, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { RootHttpApi } from "../api"
import type { AdminProviderInput, AdminUpdateInput } from "../groups/admin"

const cookieName = "incode_admin"
const sessionMaxAge = 60 * 60 * 24 * 14

function readToken(request: HttpServerRequest.HttpServerRequest) {
  const header = request.headers.cookie ?? ""
  const item = header.split(";").find((part) => part.trim().startsWith(`${cookieName}=`))
  return item?.trim().slice(cookieName.length + 1)
}

function useSecureCookie(request: HttpServerRequest.HttpServerRequest) {
  return new URL(request.url).protocol === "https:" || request.headers["x-forwarded-proto"] === "https"
}

function setSessionCookie(token: string, request: HttpServerRequest.HttpServerRequest) {
  const secure = useSecureCookie(request) ? "; Secure" : ""
  return HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      HttpServerResponse.setHeader(
        response,
        "set-cookie",
        `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAge}${secure}`,
      ),
    ),
  )
}

function clearSessionCookie(request: HttpServerRequest.HttpServerRequest) {
  const secure = useSecureCookie(request) ? "; Secure" : ""
  return HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      HttpServerResponse.setHeader(
        response,
        "set-cookie",
        `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
      ),
    ),
  )
}

function validateProvider(input: AdminProviderInput) {
  return Effect.fnUntraced(function* () {
    if (!input.kind || input.kind === "cloud") return { baseURL: input.baseURL, models: input.models ?? [] }
    const base = (input.baseURL ?? input.api ?? "").replace(/\/+$/, "")
    if (!base) return yield* Effect.fail(new Error("Base URL is required"))

    if (input.kind === "ollama") {
      const host = base.endsWith("/v1") ? base.slice(0, -3) : base
      const response = yield* Effect.tryPromise({
        try: () => fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) }),
        catch: () => new Error(`Cannot reach Ollama at ${host}`),
      })
      if (!response.ok) return yield* Effect.fail(new Error(`Ollama returned HTTP ${response.status}`))
      const body = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () => new Error("Ollama returned invalid JSON"),
      })
      const discovered =
        typeof body === "object" && body !== null && "models" in body && Array.isArray((body as { models?: unknown[] }).models)
          ? (body as { models: unknown[] }).models.flatMap((item) =>
              typeof item === "object" && item !== null && "name" in item && typeof item.name === "string"
                ? [item.name]
                : [],
            )
          : []
      const models = discovered.length > 0 ? discovered : (input.models ?? [])
      if (models.length === 0) return yield* Effect.fail(new Error("No Ollama models found"))
      return { baseURL: `${host}/v1`, models }
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${base}/models`, {
          signal: AbortSignal.timeout(5000),
          headers: input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : undefined,
        }),
      catch: () => new Error(`Cannot reach ${base}`),
    })
    if (!response.ok) return yield* Effect.fail(new Error(`Provider returned HTTP ${response.status}`))
    const body = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => new Error("Provider returned invalid JSON"),
    })
    const discovered =
      typeof body === "object" && body !== null && "data" in body && Array.isArray((body as { data?: unknown[] }).data)
        ? (body as { data: unknown[] }).data.flatMap((item) =>
            typeof item === "object" && item !== null && "id" in item && typeof item.id === "string" ? [item.id] : [],
          )
        : []
    const models = discovered.length > 0 ? discovered : (input.models ?? [])
    if (models.length === 0) return yield* Effect.fail(new Error("No models found"))
    return { baseURL: base, models }
  })()
}

const asAdminError = Effect.mapError(() => new HttpApiError.BadRequest({}))

function applyProviderUpdate(current: ConfigV1.Info, input: AdminUpdateInput, validated: { baseURL?: string; models: string[] }) {
  const next: ConfigV1.Info = { ...current }
  if (input.model !== undefined) next.model = input.model || undefined

  const provider = input.provider
  if (!provider) return next

  const existing = current.provider?.[provider.id]
  const options: Record<string, unknown> = { ...(existing?.options ?? {}) }
  if (validated.baseURL) options.baseURL = validated.baseURL
  if (provider.apiKey !== undefined) options.apiKey = provider.apiKey || undefined
  if (provider.kind === "ollama" && options.apiKey === undefined) options.apiKey = "ollama"

  const models = validated.models.length > 0 ? validated.models : (provider.models ?? [])
  next.provider = {
    ...(current.provider ?? {}),
    [provider.id]: {
      ...existing,
      name: provider.name ?? existing?.name,
      npm:
        provider.npm ??
        existing?.npm ??
        (provider.kind === "ollama" || provider.kind === "openai-compatible" ? "@ai-sdk/openai-compatible" : undefined),
      api: provider.api ?? existing?.api,
      options,
      models: models.length > 0 ? Object.fromEntries(models.map((model) => [model, { name: model }])) : existing?.models,
    },
  }

  const disabled = new Set(next.disabled_providers ?? [])
  const enabled = next.enabled_providers ? new Set(next.enabled_providers) : undefined
  if (provider.enabled === false) {
    disabled.add(provider.id)
    enabled?.delete(provider.id)
  }
  if (provider.enabled === true) {
    disabled.delete(provider.id)
    enabled?.add(provider.id)
  }
  next.disabled_providers = disabled.size > 0 ? [...disabled] : undefined
  next.enabled_providers = enabled ? [...enabled] : undefined

  return next
}

export const adminHandlers = HttpApiBuilder.group(RootHttpApi, "admin", (handlers) =>
  Effect.gen(function* () {
    const admin = yield* Admin.Service
    const config = yield* Config.Service
    const provider = yield* Provider.Service
    const bridge = yield* EffectBridge.make()

    const requireAdmin = Effect.fnUntraced(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      if (yield* admin.authorize(readToken(request))) return
      return yield* new HttpApiError.Unauthorized({})
    })

    const current = Effect.fnUntraced(function* () {
      const cfg = yield* config.getGlobal()
      const providers = yield* provider.list()
      return {
        model: cfg.model,
        providers: Object.values(providers).map((item) => ({
          id: item.id,
          name: item.name,
          models: Object.values(item.models).map((model) => ({ id: model.id, name: model.name })),
        })),
      }
    })

    return handlers
      .handle("status", () =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          return yield* admin.status(readToken(request))
        }),
      )
      .handle("setup", (ctx: { payload: Credentials }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const token = yield* admin.setup(ctx.payload).pipe(
            Effect.tapError((error) => Effect.logError("admin setup failed", { error: String(error) })),
            asAdminError,
          )
          yield* setSessionCookie(token, request)
          return yield* admin.status(token)
        }),
      )
      .handle("login", (ctx: { payload: Credentials }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          const token = yield* admin.login(ctx.payload)
          if (!token) return yield* new HttpApiError.Unauthorized({})
          yield* setSessionCookie(token, request)
          return yield* admin.status(token)
        }),
      )
      .handle("logout", () =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* admin.logout(readToken(request))
          yield* clearSessionCookie(request)
          return yield* admin.status(undefined)
        }),
      )
      .handle("modelConfig", () =>
        Effect.gen(function* () {
          yield* requireAdmin()
          return yield* current()
        }),
      )
      .handle("modelConfigUpdate", (ctx: { payload: AdminUpdateInput }) =>
        Effect.gen(function* () {
          yield* requireAdmin()
          const cfg = yield* config.getGlobal()
          const validated = yield* (ctx.payload.provider ? validateProvider(ctx.payload.provider) : Effect.succeed({ models: [] })).pipe(
            asAdminError,
          )
          const result = yield* config.updateGlobal(applyProviderUpdate(cfg, ctx.payload, validated)).pipe(asAdminError)
          if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
          return yield* current()
        }),
      )
  }),
)
