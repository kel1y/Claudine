import { WordmarkV2 } from "@opencode-ai/ui/v2/wordmark-v2"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import type { PromptProjectController } from "@/components/prompt-project-selector"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import type { NewSessionDraftController } from "./new-session-draft-controller"
import type { NewSessionWorkspaceController } from "./new-session-workspace-controller"

export function NewSessionView(props: {
  input: NewSessionDraftController["input"]
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
}) {
  return (
    <div class="@container relative flex flex-col min-h-0 h-full flex-1">
      <div
        data-component="session-new-design"
        class="relative flex-1 min-h-0 overflow-hidden rounded-[10px] bg-v2-background-bg-deep"
      >
        <div class="absolute inset-x-0 top-[25.375%] flex justify-center px-6">
          <div class={NEW_SESSION_CONTENT_WIDTH}>
            <WordmarkV2 class="h-auto w-full text-v2-background-bg-inverse" />
            <div class="mt-8">
              <PromptInputV2Composer controller={props.input} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
