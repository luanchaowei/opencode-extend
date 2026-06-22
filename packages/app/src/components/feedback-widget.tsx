import { createSignal, onMount, onCleanup, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useDevice } from "@/context/device"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { Icon } from "@opencode-ai/ui/icon"
import { CaseLibraryDialog } from "./dialog-case-library"

export function FeedbackWidget() {
  const language = useLanguage()
  const device = useDevice()
  const dialog = useDialog()
  const [positionY, setPositionY] = createSignal(window.innerHeight - 200)
  const [isDragging, setIsDragging] = createSignal(false)
  const [dragOffsetY, setDragOffsetY] = createSignal(0)
  
  let widgetRef: HTMLDivElement | undefined

  const handleMouseDown = (e: MouseEvent) => {
    if (!widgetRef) return
    setIsDragging(true)
    const rect = widgetRef.getBoundingClientRect()
    setDragOffsetY(e.clientY - rect.top)
    e.preventDefault()
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return
    const newY = e.clientY - dragOffsetY()
    const maxY = window.innerHeight - 80
    setPositionY(Math.max(0, Math.min(newY, maxY)))
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  onMount(() => {
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  })

  onCleanup(() => {
    document.removeEventListener("mousemove", handleMouseMove)
    document.removeEventListener("mouseup", handleMouseUp)
  })

  return (
    <div
      ref={widgetRef}
      class="fixed right-4 z-50 flex flex-col gap-2 cursor-move select-none"
      style={{
        top: `${positionY()}px`,
      }}
      onMouseDown={handleMouseDown}
    >
      <Show when={device.caseLibraryDir()}>
        <div
          class="flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm text-12-medium transition-all border cursor-pointer"
          style="background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3); color: #f59e0b;"
          onClick={(e) => {
            if (isDragging()) return
            e.stopPropagation()
            dialog.show(() => <CaseLibraryDialog />)
          }}
        >
          <Icon name="book" size="small" class="text-icon-weak" />
          {language.t("enterprise.caseLibrary")}
        </div>
      </Show>
      <Show when={device.contactAdmin().length > 0}>
        <HoverCard
          placement="left"
          openDelay={200}
          closeDelay={100}
          trigger={
            <div 
              class="flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm text-12-medium transition-all border cursor-help"
              style="background: rgba(59, 130, 246, 0.1); border-color: rgba(59, 130, 246, 0.3); color: #2563eb;"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {language.t("enterprise.contactAdmin")}
            </div>
          }
        >
          <div class="flex flex-col gap-1 text-left p-2 bg-surface-panel rounded-md border border-border-weak-base shadow-md select-text">
            <For each={device.contactAdmin()}>
              {(contact) => <div class="text-12-regular">{contact}</div>}
            </For>
          </div>
        </HoverCard>
      </Show>
      <div
          class="flex items-center gap-2 px-3 py-2 rounded-lg shadow-sm text-12-medium transition-all border cursor-pointer"
          style="background: rgba(34, 197, 94, 0.1); border-color: rgba(34, 197, 94, 0.3); color: #22c55e;"
          onClick={(e) => {
            if (isDragging()) return
            e.stopPropagation()
            const url = device.feedbackUrl()
            if (url) window.open(url, "_blank")
          }}
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          {language.t("enterprise.feedback")}
      </div>
    </div>
  )
}