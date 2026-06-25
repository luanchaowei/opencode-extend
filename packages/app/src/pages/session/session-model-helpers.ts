import type { UserMessage } from "@opencode-ai/sdk/v2"

type Local = {
  session: {
    reset(): void
    restore(msg: UserMessage): void
  }
}

export const syncSessionModel = (local: Local, msg: UserMessage) => {
  local.session.restore(msg)
}
