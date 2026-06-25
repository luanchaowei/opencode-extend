import { createSignal, createMemo, For, Show, onCleanup } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { TextField } from "@opencode-ai/ui/text-field"
import { useLayout } from "@/context/layout"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { decode64 } from "@/utils/base64"
import { sessionTitle } from "@/utils/session-title"
import { sortedRootSessions } from "@/pages/layout/helpers"

export function SessionSearchPopover() {
  const navigate = useNavigate()
  const params = useParams()
  const layout = useLayout()
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const [search, setSearch] = createSignal("")
  const [showDropdown, setShowDropdown] = createSignal(false)
  let containerRef: HTMLDivElement | undefined

  const directory = createMemo(() => params.dir ? decode64(params.dir) : undefined)

  const sessions = createMemo(() => {
    const dir = directory()
    if (!dir) return []
    const [store] = globalSync.child(dir, { bootstrap: false })
    return sortedRootSessions(store, Date.now())
  })

  const filtered = createMemo(() => {
    const q = search().toLowerCase().trim()
    if (!q) return sessions().slice(0, 10)
    return sessions()
      .filter(s => (s.title || "").toLowerCase().includes(q))
      .slice(0, 10)
  })

  const goToSession = (sessionId: string) => {
    const dir = params.dir
    if (!dir) return
    navigate(`/${dir}/session/${sessionId}`)
    setSearch("")
    setShowDropdown(false)
  }

  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setShowDropdown(false)
    }
  }

  document.addEventListener("click", handleClickOutside)
  onCleanup(() => document.removeEventListener("click", handleClickOutside))

  return (
    <div ref={containerRef} class="relative flex items-center">
      <TextField
        placeholder={language.t("session.search.placeholder")}
        value={search()}
        onChange={(v) => {
          setSearch(v)
          setShowDropdown(true)
        }}
        onFocus={() => setShowDropdown(true)}
        class="w-48 h-6 text-12-regular"
      />
      <Show when={showDropdown()}>
        <div class="absolute top-full left-0 mt-1 w-full bg-background-base border border-border-weaker-base rounded-lg shadow-lg z-50 max-h-48 overflow-y-auto">
          <Show when={filtered().length === 0}>
            <div class="text-14-regular text-text-weaker text-center py-4">
              {language.t("session.search.empty")}
            </div>
          </Show>
          <For each={filtered()}>
            {(session) => (
              <button
                class="w-full text-left px-2 py-1.5 rounded hover:bg-surface-interactive-weak text-14-regular truncate"
                onClick={() => goToSession(session.id)}
              >
                {sessionTitle(session.title)}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}