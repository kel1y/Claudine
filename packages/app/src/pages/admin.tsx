import { createSignal, For, onMount, Show } from "solid-js"

type Status = { configured: boolean; authenticated: boolean }
type Provider = { id: string; name: string; models: { id: string; name?: string }[] }
type ModelConfig = { model?: string; providers: Provider[] }

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!response.ok) throw new Error(response.status === 401 ? "unauthorized" : await response.text())
  return response.json()
}

export default function AdminPage() {
  const [status, setStatus] = createSignal<Status>()
  const [config, setConfig] = createSignal<ModelConfig>()
  const [error, setError] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [username, setUsername] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [model, setModel] = createSignal("")
  const [providerID, setProviderID] = createSignal("")
  const [providerName, setProviderName] = createSignal("")
  const [kind, setKind] = createSignal("cloud")
  const [baseURL, setBaseURL] = createSignal("")
  const [apiKey, setAPIKey] = createSignal("")
  const [models, setModels] = createSignal("")
  const [enabled, setEnabled] = createSignal(true)

  const view = () => {
    const current = status()
    if (!current) return "loading"
    if (!current.configured) return "setup"
    return current.authenticated ? "config" : "login"
  }

  const loadConfig = async () => {
    const value = await api<ModelConfig>("/global/admin/model-config")
    setConfig(value)
    setModel(value.model ?? "")
  }

  const refresh = async () => {
    setError("")
    try {
      const value = await api<Status>("/global/admin/status")
      setStatus(value)
      if (value.authenticated) await loadConfig()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const submitAuth = async (event: Event) => {
    event.preventDefault()
    if (busy()) return
    setBusy(true)
    setError("")
    try {
      const setup = view() === "setup"
      await api<Status>(`/global/admin/${setup ? "setup" : "login"}`, {
        method: "POST",
        body: JSON.stringify({ username: username(), password: password() }),
      })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const save = async (event: Event) => {
    event.preventDefault()
    if (busy()) return
    setBusy(true)
    setError("")
    try {
      const provider = providerID().trim()
      const value = await api<ModelConfig>("/global/admin/model-config", {
        method: "PUT",
        body: JSON.stringify({
          model: model().trim() || undefined,
          provider: provider
            ? {
                id: provider,
                name: providerName().trim() || undefined,
                kind: kind(),
                baseURL: baseURL().trim() || undefined,
                apiKey: apiKey() || undefined,
                models: models()
                  .split(/[\n,]+/)
                  .map((item) => item.trim())
                  .filter(Boolean),
                enabled: enabled(),
              }
            : undefined,
        }),
      })
      setConfig(value)
      setAPIKey("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  onMount(() => void refresh())

  return (
    <div class="min-h-dvh bg-v2-background-bg-deep px-4 py-10 text-v2-text-text-base">
      <div class="mx-auto flex w-full max-w-160 flex-col gap-6 rounded-xl bg-v2-background-bg-base p-6 shadow-[var(--v2-elevation-raised)]">
        <h1 class="text-18-medium text-v2-text-text-strong">Admin</h1>
        <Show when={error()}>
          <div class="rounded-md border border-v2-border-border-muted px-3 py-2 text-13-regular text-v2-text-text-error">
            {error()}
          </div>
        </Show>

        <Show when={view() === "loading"}>
          <div class="text-14-regular text-v2-text-text-muted">Loading</div>
        </Show>

        <Show when={view() === "setup" || view() === "login"}>
          <form class="flex flex-col gap-4" onSubmit={submitAuth}>
            <div class="text-14-regular text-v2-text-text-muted">
              {view() === "setup" ? "Create the admin account." : "Sign in as admin."}
            </div>
            <input
              class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
              value={username()}
              onInput={(event) => setUsername(event.currentTarget.value)}
              placeholder="Username"
              autocomplete="username"
            />
            <input
              class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
              type="password"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
              placeholder="Password"
              autocomplete={view() === "setup" ? "new-password" : "current-password"}
            />
            <button class="rounded-md bg-v2-background-bg-inverse px-3 py-2 text-v2-text-text-on-accent" disabled={busy()}>
              {view() === "setup" ? "Create admin" : "Sign in"}
            </button>
          </form>
        </Show>

        <Show when={view() === "config"}>
          <form class="flex flex-col gap-4" onSubmit={save}>
            <label class="flex flex-col gap-1">
              <span class="text-12-medium text-v2-text-text-muted">Active model</span>
              <input
                class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
                value={model()}
                onInput={(event) => setModel(event.currentTarget.value)}
                placeholder="provider/model"
              />
            </label>

            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <input
                class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
                value={providerID()}
                onInput={(event) => setProviderID(event.currentTarget.value)}
                placeholder="Provider ID"
              />
              <input
                class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
                value={providerName()}
                onInput={(event) => setProviderName(event.currentTarget.value)}
                placeholder="Display name"
              />
              <select
                class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
                value={kind()}
                onChange={(event) => setKind(event.currentTarget.value)}
              >
                <option value="cloud">Cloud</option>
                <option value="openai-compatible">OpenAI-compatible</option>
                <option value="ollama">Ollama</option>
              </select>
              <input
                class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
                value={baseURL()}
                onInput={(event) => setBaseURL(event.currentTarget.value)}
                placeholder="Base URL"
              />
              <input
                class="rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
                type="password"
                value={apiKey()}
                onInput={(event) => setAPIKey(event.currentTarget.value)}
                placeholder="API key"
                autocomplete="off"
              />
              <label class="flex items-center gap-2 text-14-regular">
                <input type="checkbox" checked={enabled()} onChange={(event) => setEnabled(event.currentTarget.checked)} />
                Enabled
              </label>
            </div>

            <textarea
              class="min-h-24 rounded-md border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-2"
              value={models()}
              onInput={(event) => setModels(event.currentTarget.value)}
              placeholder="Models, one per line"
            />

            <button class="rounded-md bg-v2-background-bg-inverse px-3 py-2 text-v2-text-text-on-accent" disabled={busy()}>
              Save
            </button>
          </form>

          <Show when={config()}>
            {(value) => (
              <div class="flex flex-col gap-2">
                <For each={value().providers}>
                  {(provider) => (
                    <div class="rounded-md border border-v2-border-border-muted px-3 py-2">
                      <div class="text-14-medium text-v2-text-text-strong">{provider.name}</div>
                      <div class="truncate text-12-regular text-v2-text-text-muted">
                        {provider.models.map((model) => model.id).join(", ")}
                      </div>
                    </div>
                  )}
                </For>
              </div>
            )}
          </Show>
        </Show>
      </div>
    </div>
  )
}
