import crypto from "crypto"
import fs from "fs/promises"
import path from "path"
import { Context, Effect, Layer, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"

const file = path.join(Global.Path.data, "admin.json")
const sessionTtl = 1000 * 60 * 60 * 24 * 14

const Stored = Schema.Struct({
  username: Schema.String,
  salt: Schema.String,
  hash: Schema.String,
  createdAt: Schema.Number,
})
type Stored = Schema.Schema.Type<typeof Stored>

export type Credentials = {
  username: string
  password: string
}

export interface Interface {
  readonly configured: () => Effect.Effect<boolean>
  readonly status: (token?: string) => Effect.Effect<{ configured: boolean; authenticated: boolean }>
  readonly setup: (input: Credentials) => Effect.Effect<string, Error>
  readonly login: (input: Credentials) => Effect.Effect<string | undefined>
  readonly logout: (token?: string) => Effect.Effect<void>
  readonly authorize: (token?: string) => Effect.Effect<boolean>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AdminAuth") {}

const read = Effect.fnUntraced(function* () {
  const text = yield* Effect.promise(() => fs.readFile(file, "utf8").catch(() => undefined))
  if (!text) return
  return yield* Effect.try(() => Schema.decodeUnknownSync(Stored)(JSON.parse(text))).pipe(Effect.catch(() => Effect.succeed(undefined)))
})

const write = Effect.fnUntraced(function* (value: Stored) {
  yield* Effect.promise(() => fs.mkdir(path.dirname(file), { recursive: true }))
  yield* Effect.promise(() => fs.writeFile(file, JSON.stringify(value, null, 2), { mode: 0o600 }))
})

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex")
}

function samePassword(password: string, stored: Stored) {
  const actual = Buffer.from(hashPassword(password, stored.salt), "hex")
  const expected = Buffer.from(stored.hash, "hex")
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = new Map<string, number>()

    const issue = Effect.sync(() => {
      const token = crypto.randomBytes(32).toString("hex")
      sessions.set(token, Date.now() + sessionTtl)
      return token
    })

    const authorize = Effect.fnUntraced(function* (token?: string) {
      if (!token) return false
      const expires = sessions.get(token)
      if (!expires) return false
      if (expires < Date.now()) {
        sessions.delete(token)
        return false
      }
      return true
    })

    return {
      configured: () => read().pipe(Effect.map((value) => value !== undefined)),
      status: (token) =>
        Effect.gen(function* () {
          const existing = yield* read()
          return { configured: existing !== undefined, authenticated: yield* authorize(token) }
        }),
      setup: Effect.fn("AdminAuth.setup")(function* (input: Credentials) {
        if (!input.username.trim() || !input.password) return yield* Effect.fail(new Error("Username and password are required"))
        if (yield* read()) return yield* Effect.fail(new Error("Admin is already configured"))
        const salt = crypto.randomBytes(16).toString("hex")
        yield* write({
          username: input.username.trim(),
          salt,
          hash: hashPassword(input.password, salt),
          createdAt: Date.now(),
        })
        return yield* issue
      }),
      login: Effect.fnUntraced(function* (input: Credentials) {
        const stored = yield* read()
        if (!stored) return
        if (stored.username !== input.username) return
        if (!samePassword(input.password, stored)) return
        return yield* issue
      }),
      logout: Effect.fnUntraced(function* (token?: string) {
        if (token) sessions.delete(token)
      }),
      authorize,
    } satisfies Interface
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as Admin from "./admin"
