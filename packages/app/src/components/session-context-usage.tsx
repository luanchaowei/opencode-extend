import { Show, createMemo, type ComponentProps, type JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Button } from "@opencode-ai/ui/button"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContext } from "@/components/session/session-context-metrics"

interface SessionContextUsageProps {
  placement?: ComponentProps<typeof Tooltip>["placement"]
}

function ContextTooltipRow(props: { name: JSX.Element; value: JSX.Element }) {
  return (
    <div class="flex min-w-0 items-center gap-4">
      <span class="shrink-0 text-text-invert-weak">{props.name}</span>
      <span class="ml-auto min-w-0 truncate text-right text-text-invert-base">{props.value}</span>
    </div>
  )
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const params = useParams()
  const sync = useSync()
  const language = useLanguage()
  const providers = useProviders()

  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))
  const context = createMemo(() => getSessionContext(messages(), providers.all()))

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle
        size={16}
        strokeWidth={2}
        percentage={context()?.usage ?? 0}
      />
    </div>
  )

  const tooltipValue = () => (
    <div class="flex w-[140px] flex-col gap-2">
      <ContextTooltipRow
        name={language.t("context.usage.limit")}
        value={context()?.limit?.toLocaleString() ?? "—"}
      />
      <ContextTooltipRow
        name={language.t("context.usage.tokens")}
        value={context()?.total?.toLocaleString() ?? "0"}
      />
      <ContextTooltipRow
        name={language.t("context.usage.usage")}
        value={`${context()?.usage ?? 0}%`}
      />
    </div>
  )

  return (
    <Show when={params.id}>
      <Tooltip value={tooltipValue()} placement={props.placement ?? "bottom"} gutter={4}>
        <Button
          type="button"
          variant="ghost"
          class="size-6 shrink-0"
          aria-label={language.t("context.usage.view")}
        >
          {circle()}
        </Button>
      </Tooltip>
    </Show>
  )
}
