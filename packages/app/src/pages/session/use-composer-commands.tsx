import { useCommand } from "@/context/command"
import type { ModelSelection } from "@/context/local"

export const useComposerCommands = (_input: { model?: ModelSelection } = {}) => {
  const command = useCommand()
  command.register("composer", () => [])
}
