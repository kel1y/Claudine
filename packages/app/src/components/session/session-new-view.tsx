import { WordmarkV2 } from "@opencode-ai/ui/v2/wordmark-v2"

const ROOT_CLASS = "size-full flex flex-col"

interface NewSessionViewProps {
  worktree: string
}

export function NewSessionView(_props: NewSessionViewProps) {
  return (
    <div class={ROOT_CLASS}>
      <div class="h-12 shrink-0" aria-hidden />
      <div class="flex-1 px-6 pb-30 flex items-center justify-center">
        <WordmarkV2 class="h-auto w-full max-w-200 text-icon-strong" />
      </div>
    </div>
  )
}
