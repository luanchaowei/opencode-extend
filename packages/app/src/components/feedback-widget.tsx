import { createSignal, onMount, onCleanup, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useDevice } from "@/context/device"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { HoverCard } from "@opencode-ai/ui/hover-card"
import { showToast } from "@opencode-ai/ui/toast"
import { Icon } from "@opencode-ai/ui/icon"
import { CaseLibraryDialog } from "./dialog-case-library"

export function FeedbackWidget() {
  const language = useLanguage()
  const device = useDevice()
  const dialog = useDialog()
  const [positionY, setPositionY] = createSignal(200)
  const [isDragging, setIsDragging] = createSignal(false)
  const [dragOffsetY, setDragOffsetY] = createSignal(0)
  const [collapsed, setCollapsed] = createSignal(false)
  const [hovered, setHovered] = createSignal(false)
  let widgetHeight = 168

  let widgetRef: HTMLDivElement | undefined

  const handleMouseDown = (e: MouseEvent) => {
    if (!widgetRef) return
    setIsDragging(true)
    const rect = widgetRef.getBoundingClientRect()
    widgetHeight = rect.height
    setDragOffsetY(e.clientY - rect.top)
    e.preventDefault()
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return
    const newTop = e.clientY - dragOffsetY()
    const newBottom = window.innerHeight - newTop - widgetHeight
    setPositionY(Math.max(0, Math.min(newBottom, window.innerHeight - 80)))
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const expandWidget = () => {
    setCollapsed(false)
    try { localStorage.setItem("feedbackCollapsed", "false") } catch {}
  }

  onMount(() => {
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    window.addEventListener("feedback-widget-expand", expandWidget)
    try {
      const saved = localStorage.getItem("feedbackCollapsed")
      if (saved === "true") setCollapsed(true)
    } catch {}
  })

  onCleanup(() => {
    document.removeEventListener("mousemove", handleMouseMove)
    document.removeEventListener("mouseup", handleMouseUp)
    window.removeEventListener("feedback-widget-expand", expandWidget)
  })

  const toggleCollapsed = (e: MouseEvent) => {
    e.stopPropagation()
    const next = !collapsed()
    setCollapsed(next)
    try { localStorage.setItem("feedbackCollapsed", String(next)) } catch {}
  }

  return (
    <Show when={collapsed()} fallback={
      <div
        ref={widgetRef}
        class="fixed right-4 z-50 flex flex-col gap-3 cursor-move select-none"
        style={{ bottom: `${positionY()}px` }}
        onMouseDown={handleMouseDown}
      >
        <Show when={device.caseLibraryDir()}>
          <div
            class="flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-14-medium transition-all border cursor-pointer hover:scale-105"
            style="background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.4); color: #f59e0b;"
            onClick={(e) => {
              if (isDragging()) return
              e.stopPropagation()
              dialog.show(() => <CaseLibraryDialog />)
            }}
          >
            <Icon name="book" size="medium" class="text-icon-weak" />
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
                class="flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-14-medium transition-all border cursor-help hover:scale-105"
                style="background: rgba(59, 130, 246, 0.12); border-color: rgba(59, 130, 246, 0.4); color: #2563eb;"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {language.t("enterprise.contactAdmin")}
              </div>
            }
          >
            <div class="flex flex-col gap-1 text-left p-2 bg-surface-panel rounded-md border border-border-weak-base shadow-md select-text">
              <For each={device.contactAdmin()}>
                {(contact) => (
                  <div
                    class="text-12-regular cursor-pointer hover:text-text-interactive-base transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      const textarea = document.createElement("textarea")
                      textarea.value = contact
                      textarea.style.position = "fixed"
                      textarea.style.opacity = "0"
                      document.body.appendChild(textarea)
                      textarea.select()
                      try {
                        document.execCommand("copy")
                        showToast({ title: language.t("enterprise.copied"), variant: "success" })
                      } catch {}
                      document.body.removeChild(textarea)
                    }}
                  >
                    {contact}
                  </div>
                )}
              </For>
            </div>
          </HoverCard>
        </Show>
        <div
          class="flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-14-medium transition-all border cursor-pointer hover:scale-105"
          style="background: rgba(34, 197, 94, 0.12); border-color: rgba(34, 197, 94, 0.4); color: #22c55e;"
          onClick={(e) => {
            if (isDragging()) return
            e.stopPropagation()
            const url = device.feedbackUrl()
            if (url) window.open(url, "_blank")
          }}
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          {language.t("enterprise.feedback")}
        </div>
        <div
          class="flex items-center justify-center self-end mt-1 cursor-pointer transition-transform hover:scale-110"
          style={{ color: "var(--text-weak)" }}
          onClick={toggleCollapsed}
          title={language.t("common.collapse")}
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    }>
      <div
        ref={widgetRef}
        class="fixed right-4 z-50 flex flex-col items-end cursor-move select-none"
        style={{ bottom: `${positionY()}px` }}
        onMouseDown={handleMouseDown}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Show when={hovered()} fallback={
          <div
            class="flex items-center justify-center w-12 h-12 rounded-full shadow-lg cursor-pointer transition-all hover:scale-110"
            style={{ background: "var(--background-stronger)", border: "1px solid var(--border-weak-base)" }}
            onClick={toggleCollapsed}
            title={language.t("common.expand")}
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: "var(--text-weak)" }}>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </div>
        }>
          <div class="flex flex-col gap-3">
            <Show when={device.caseLibraryDir()}>
              <div
                class="flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-14-medium transition-all border cursor-pointer hover:scale-105"
                style="background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.4); color: #f59e0b;"
                onClick={(e) => {
                  e.stopPropagation()
                  dialog.show(() => <CaseLibraryDialog />)
                }}
              >
                <Icon name="book" size="medium" class="text-icon-weak shrink-0" />
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
                    class="flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-14-medium transition-all border cursor-help hover:scale-105"
                    style="background: rgba(59, 130, 246, 0.12); border-color: rgba(59, 130, 246, 0.4); color: #2563eb;"
                  >
                    <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    {language.t("enterprise.contactAdmin")}
                  </div>
                }
              >
                <div class="flex flex-col gap-1 text-left p-2 bg-surface-panel rounded-md border border-border-weak-base shadow-md select-text">
                  <For each={device.contactAdmin()}>
                    {(contact) => (
                      <div
                        class="text-12-regular cursor-pointer hover:text-text-interactive-base transition-colors"
                        onClick={(e) => {
                          e.stopPropagation()
                          const textarea = document.createElement("textarea")
                          textarea.value = contact
                          textarea.style.position = "fixed"
                          textarea.style.opacity = "0"
                          document.body.appendChild(textarea)
                          textarea.select()
                          try {
                            document.execCommand("copy")
                            showToast({ title: language.t("enterprise.copied"), variant: "success" })
                          } catch {}
                          document.body.removeChild(textarea)
                        }}
                      >
                        {contact}
                      </div>
                    )}
                  </For>
                </div>
              </HoverCard>
            </Show>
            <div
              class="flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-14-medium transition-all border cursor-pointer hover:scale-105"
              style="background: rgba(34, 197, 94, 0.12); border-color: rgba(34, 197, 94, 0.4); color: #22c55e;"
              onClick={(e) => {
                e.stopPropagation()
                const url = device.feedbackUrl()
                if (url) window.open(url, "_blank")
              }}
            >
              <svg class="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
              </svg>
              {language.t("enterprise.feedback")}
            </div>
            <div
              class="flex items-center justify-center self-end mt-1 cursor-pointer transition-transform hover:scale-110"
              style={{ color: "var(--text-weak)" }}
              onClick={toggleCollapsed}
              title={language.t("common.expand")}
            >
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
              </svg>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
