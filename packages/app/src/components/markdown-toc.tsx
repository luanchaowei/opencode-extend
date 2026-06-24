import { createSignal, createEffect, onCleanup, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/icon"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { useLanguage } from "@/context/language"

interface TOCItem {
  id: string
  level: number
  text: string
}

export function MarkdownTOC(props: {
  containerRef: HTMLElement | undefined
}) {
  const language = useLanguage()
  const [tocItems, setTocItems] = createSignal<TOCItem[]>([])
  const [activeId, setActiveId] = createSignal<string>("")
  const [store, setStore] = createStore({
    width: 200,
  })

  const extractTOC = (): TOCItem[] => {
    if (!props.containerRef) return []
    const headings = props.containerRef.querySelectorAll("h1, h2, h3, h4, h5, h6")
    return Array.from(headings)
      .filter((h) => h.id)
      .map((h) => ({
        id: h.id,
        level: parseInt(h.tagName[1]),
        text: h.textContent || "",
      }))
  }

  createEffect(() => {
    if (!props.containerRef) return
    setTocItems(extractTOC())

    const observer = new MutationObserver(() => {
      setTocItems(extractTOC())
    })
    observer.observe(props.containerRef, { childList: true, subtree: true })

    onCleanup(() => observer.disconnect())
  })

  createEffect(() => {
    if (!props.containerRef || tocItems().length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length > 0) {
          const topMost = visible.reduce((prev, curr) =>
            curr.boundingClientRect.top < prev.boundingClientRect.top ? curr : prev
          )
          setActiveId((topMost.target as HTMLElement).id)
        }
      },
      {
        rootMargin: "-20px 0px -80% 0px",
        threshold: 0,
      }
    )

    tocItems().forEach((item) => {
      const el = props.containerRef?.querySelector(`#${CSS.escape(item.id)}`)
      if (el) observer.observe(el)
    })

    onCleanup(() => observer.disconnect())
  })

  const scrollTo = (id: string) => {
    const el = props.containerRef?.querySelector(`#${CSS.escape(id)}`)
    el?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const getDisplayText = (text: string) => {
    return text.length > 30 ? text.substring(0, 27) + "..." : text
  }

  return (
    <div
      class="border-l border-border-weak-base flex flex-col min-h-0 shrink-0 relative"
      style={{ width: `${store.width}px` }}
    >
      <div class="flex items-center gap-2 px-2 py-1 border-b border-border-weak-base min-h-[36px] shrink-0">
        <Icon name="bullet-list" size="small" class="text-icon-weak" />
        <span class="text-11-regular text-text-weak">{language.t("enterprise.toc.title")}</span>
      </div>

      <div class="flex-1 overflow-y-auto p-2 min-h-0">
        <Show when={tocItems().length === 0}>
          <div class="text-12-regular text-text-weak">{language.t("enterprise.toc.empty")}</div>
        </Show>

        <For each={tocItems()}>
          {(item) => (
            <div
              class="flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer hover:bg-surface-raised-base rounded text-12-regular transition-colors"
              classList={{
                "bg-surface-raised-base text-text-strong": activeId() === item.id,
                "text-text-weak": activeId() !== item.id,
              }}
              style={`padding-left: ${(item.level - 1) * 12}px`}
              onClick={() => scrollTo(item.id)}
            >
              <span class="truncate" title={item.text}>{getDisplayText(item.text)}</span>
            </div>
          )}
        </For>
      </div>

      <ResizeHandle
        direction="horizontal"
        edge="start"
        size={store.width}
        min={150}
        max={400}
        onResize={(width) => {
          setStore("width", width)
        }}
      />
    </div>
  )
}