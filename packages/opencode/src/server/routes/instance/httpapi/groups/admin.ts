import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/global/admin"

export const AdminCredentials = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
})

export class AdminApiError extends Schema.ErrorClass<AdminApiError>()(
  "AdminApiError",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

const AdminStatus = Schema.Struct({
  configured: Schema.Boolean,
  authenticated: Schema.Boolean,
})

const AdminModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
})

const AdminProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  models: Schema.Array(AdminModel),
})

const AdminModelConfig = Schema.Struct({
  model: Schema.optional(Schema.String),
  providers: Schema.Array(AdminProvider),
})

const AdminProviderInput = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(["cloud", "openai-compatible", "ollama"])),
  npm: Schema.optional(Schema.String),
  api: Schema.optional(Schema.String),
  baseURL: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
  models: Schema.optional(Schema.Array(Schema.String)),
  enabled: Schema.optional(Schema.Boolean),
})

const AdminUpdateInput = Schema.Struct({
  model: Schema.optional(Schema.String),
  provider: Schema.optional(AdminProviderInput),
})
export type AdminProviderInput = Schema.Schema.Type<typeof AdminProviderInput>
export type AdminUpdateInput = Schema.Schema.Type<typeof AdminUpdateInput>

export const AdminApi = HttpApi.make("admin")
  .add(
    HttpApiGroup.make("admin")
      .add(
        HttpApiEndpoint.get("status", `${root}/status`, {
          success: AdminStatus,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "admin.status",
            summary: "Get admin status",
          }),
        ),
        HttpApiEndpoint.post("setup", `${root}/setup`, {
          payload: AdminCredentials,
          success: AdminStatus,
          error: AdminApiError,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "admin.setup",
            summary: "Create the initial admin account",
          }),
        ),
        HttpApiEndpoint.post("login", `${root}/login`, {
          payload: AdminCredentials,
          success: AdminStatus,
          error: HttpApiError.Unauthorized,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "admin.login",
            summary: "Log in as admin",
          }),
        ),
        HttpApiEndpoint.post("logout", `${root}/logout`, {
          success: AdminStatus,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "admin.logout",
            summary: "Log out as admin",
          }),
        ),
        HttpApiEndpoint.get("modelConfig", `${root}/model-config`, {
          success: AdminModelConfig,
          error: HttpApiError.Unauthorized,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "admin.modelConfig.get",
            summary: "Get sanitized model configuration",
          }),
        ),
        HttpApiEndpoint.put("modelConfigUpdate", `${root}/model-config`, {
          payload: AdminUpdateInput,
          success: AdminModelConfig,
          error: [HttpApiError.Unauthorized, AdminApiError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "admin.modelConfig.update",
            summary: "Update model and provider configuration",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "admin",
          description: "Admin-only model and provider configuration routes.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "incode admin HttpApi",
      version: "0.0.1",
    }),
  )
