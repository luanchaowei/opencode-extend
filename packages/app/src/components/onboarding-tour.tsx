import { createSignal, onMount, onCleanup, Show, createEffect } from "solid-js"
import { useLanguage } from "@/context/language"
import { useDevice } from "@/context/device"
import { useLayout } from "@/context/layout"
import { useParams } from "@solidjs/router"
import { getFilename } from "@opencode-ai/core/util/path"

const STORAGE_KEY = "onboarding-completed"

type Step = {
  selector: string | null
  titleKey: string
  descKey: string
  skipIf?: () => boolean
  beforeStep?: () => void
}

export function OnboardingTour() {
  const language = useLanguage()
  const device = useDevice()
  const layout = useLayout()
  const params = useParams()

  const [active, setActive] = createSignal(false)
  const [stepIndex, setStepIndex] = createSignal(0)
  const [targetRect, setTargetRect] = createSignal<DOMRect | null>(null)
  let started = false
  let rafId: number | undefined

  const steps: Step[] = [
    {
      selector: null,
      titleKey: "onboarding.welcome.title",
      descKey: "onboarding.welcome.description",
    },
    {
      selector: '[data-component="announcement"]',
      titleKey: "onboarding.announcement.title",
      descKey: "onboarding.announcement.description",
      skipIf: () => !document.querySelector('[data-component="announcement"]'),
    },
    {
      selector: '[data-component="sidebar-nav-desktop"]',
      titleKey: "onboarding.sessions.title",
      descKey: "onboarding.sessions.description",
      beforeStep: () => {
        if (!layout.sidebar.opened()) layout.sidebar.open()
      },
    },
    {
      selector: '[data-component="prompt-input"]',
      titleKey: "onboarding.input.title",
      descKey: "onboarding.input.description",
    },
    {
      selector: "#side-panel",
      titleKey: "onboarding.filetree.title",
      descKey: "onboarding.filetree.description",
      beforeStep: () => {
        if (!layout.fileTree.opened()) layout.fileTree.open()
      },
    },
    {
      selector: '[data-component="usage-guide"]',
      titleKey: "onboarding.usageGuide.title",
      descKey: "onboarding.usageGuide.description",
      skipIf: () => !document.querySelector('[data-component="usage-guide"]'),
    },
    {
      selector: "#opencode-titlebar-left button",
      titleKey: "onboarding.help.title",
      descKey: "onboarding.help.description",
      skipIf: () => !device.helpDocUrl(),
    },
    {
      selector: "#onboarding-button",
      titleKey: "onboarding.onboardingButton.title",
      descKey: "onboarding.onboardingButton.description",
    },
    {
      selector: ".fixed.right-4",
      titleKey: "onboarding.feedback.title",
      descKey: "onboarding.feedback.description",
      beforeStep: () => {
        window.dispatchEvent(new CustomEvent("feedback-widget-expand"))
      },
    },
    {
      selector: null,
      titleKey: "onboarding.complete.title",
      descKey: "onboarding.complete.description",
    },
  ]

  const waitForElement = (selector: string, timeout = 3000): Promise<HTMLElement | null> => {
    return new Promise((resolve) => {
      const start = Date.now()
      const check = () => {
        const el = document.querySelector(selector) as HTMLElement
        if (el) {
          resolve(el)
          return
        }
        if (Date.now() - start > timeout) {
          resolve(null)
          return
        }
        rafId = requestAnimationFrame(check)
      }
      check()
    })
  }

  const updateTargetRect = async () => {
    const step = steps[stepIndex()]
    if (!step || !step.selector) {
      setTargetRect(null)
      return
    }
    const el = await waitForElement(step.selector)
    if (!el) {
      setTargetRect(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const inViewport = rect.top > 0 && rect.bottom < window.innerHeight
    if (!inViewport) {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
      await new Promise((r) => setTimeout(r, 300))
    }
    setTargetRect(el.getBoundingClientRect())
  }

  const goToStep = async (index: number) => {
    let next = index
    while (next < steps.length && next >= 0) {
      const step = steps[next]
      if (step?.skipIf?.()) {
        next += index > stepIndex() ? 1 : -1
        continue
      }
      break
    }
    if (next < 0) next = 0
    if (next >= steps.length) {
      setActive(false)
      return
    }
    const step = steps[next]
    let needWait = false
    if (step?.beforeStep) {
      const fileTreeWasOpen = layout.fileTree.opened()
      step.beforeStep()
      if (step.selector === "#side-panel" && !fileTreeWasOpen) needWait = true
      if (step.selector === ".fixed.right-4") needWait = true
    }
    if (needWait) {
      await new Promise((r) => setTimeout(r, 350))
    }
    const el = step?.selector ? await waitForElement(step.selector) : null
    if (step?.selector && el) {
      const rect = el.getBoundingClientRect()
      const inViewport = rect.top > 0 && rect.bottom < window.innerHeight
      if (!inViewport) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        await new Promise((r) => setTimeout(r, 300))
      }
    }
    setStepIndex(next)
    setTargetRect(el ? el.getBoundingClientRect() : null)
  }

  const start = () => {
    if (started) return
    started = true
    setStepIndex(0)
    setActive(true)
    setTimeout(() => goToStep(0), 100)
  }

  const close = () => {
    setActive(false)
    localStorage.setItem("onboarding-completed", "true")
    if (rafId) cancelAnimationFrame(rafId)
  }

  const handleNext = () => goToStep(stepIndex() + 1)
  const handlePrev = () => goToStep(stepIndex() - 1)
  const handleSkip = () => {
    setActive(false)
    if (rafId) cancelAnimationFrame(rafId)
  }

  const handleResize = () => {
    if (!active()) return
    const step = steps[stepIndex()]
    if (step?.selector) updateTargetRect()
  }

  const handleStartEvent = () => {
    started = false
    start()
  }

  createEffect(() => {
    const dir = params.dir
    const ip = device.clientIP()
    if (!dir || !ip || ip === "localhost" || ip === "unknown") return
    const directory = decodeURIComponent(escape(atob(dir)))
    const dirName = getFilename(directory)
    if (dirName !== ip) return
    if (started) return
    if (localStorage.getItem("onboarding-completed")) return
    setTimeout(() => start(), 1500)
  })

  onMount(() => {
    window.addEventListener("resize", handleResize)
    window.addEventListener("start-onboarding", handleStartEvent as EventListener)
  })

  onCleanup(() => {
    window.removeEventListener("resize", handleResize)
    window.removeEventListener("start-onboarding", handleStartEvent as EventListener)
    if (rafId) cancelAnimationFrame(rafId)
  })

  const cardPosition = () => {
    const rect = targetRect()
    if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }
    const cardWidth = 340
    const cardHeight = 200
    const gap = 16
    if (rect.right + gap + cardWidth < window.innerWidth) {
      const top = Math.min(rect.top, window.innerHeight - cardHeight - gap)
      return { top: `${top}px`, left: `${rect.right + gap}px`, transform: "none" }
    }
    if (rect.bottom + gap + cardHeight < window.innerHeight) {
      const left = Math.min(rect.left, window.innerWidth - cardWidth - gap)
      return { top: `${rect.bottom + gap}px`, left: `${left}px`, transform: "none" }
    }
    if (rect.left - gap - cardWidth > 0) {
      const top = Math.min(rect.top, window.innerHeight - cardHeight - gap)
      return { top: `${top}px`, left: `${rect.left - gap - cardWidth}px`, transform: "none" }
    }
    const top = Math.max(gap, rect.top - cardHeight - gap)
    const left = Math.min(rect.left, window.innerWidth - cardWidth - gap)
    return { top: `${top}px`, left: `${left}px`, transform: "none" }
  }

  const currentStep = () => steps[stepIndex()]
  const isWelcome = () => stepIndex() === 0
  const isComplete = () => stepIndex() === steps.length - 1
  const isCentered = () => !currentStep()?.selector

  return (
    <Show when={active()}>
      <div class="fixed inset-0 z-[1000]">
        <Show when={targetRect()}>
          <div
            class="fixed"
            style={{
              top: `${targetRect()!.top - 4}px`,
              left: `${targetRect()!.left - 4}px`,
              width: `${targetRect()!.width + 8}px`,
              height: `${targetRect()!.height + 8}px`,
              "box-shadow": "0 0 0 9999px rgba(0, 0, 0, 0.6)",
              "border-radius": "8px",
              transition: "all 0.3s ease",
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </Show>
        <Show when={!targetRect()}>
          <div class="fixed inset-0" style={{ background: "rgba(0, 0, 0, 0.6)" }} onClick={(e) => e.stopPropagation()} />
        </Show>
        <div
          class="fixed"
          style={{
            ...cardPosition(),
            transition: "all 0.3s ease",
          }}
        >
          <div
            class="w-[340px] rounded-xl border border-border-weak-base shadow-2xl p-5"
            style={{ background: "var(--bg-surface-panel, #fff)" }}
          >
            <div class="flex items-center gap-2 mb-3">
              <div
                class="flex items-center justify-center w-7 h-7 rounded-full text-12-medium shrink-0"
                style={{ background: "var(--bg-accent-subtle, #e0e7ff)", color: "var(--text-interactive-base, #4f46e5)" }}
              >
                {stepIndex() + 1}
              </div>
              <h3 class="text-14-medium text-text-strong-base flex-1">
                {language.t(currentStep()?.titleKey ?? "")}
              </h3>
            </div>
            <p class="text-13-regular text-text-weak-base leading-relaxed mb-4">
              {language.t(currentStep()?.descKey ?? "")}
            </p>
            <div class="flex items-center justify-between gap-2">
              <Show when={!isComplete()}>
                <button
                  class="text-12-regular text-text-weaker-base hover:text-text-weak-base transition-colors"
                  onClick={handleSkip}
                >
                  {language.t("onboarding.button.skip")}
                </button>
              </Show>
              <Show when={isComplete()}>
                <div />
              </Show>
              <div class="flex items-center gap-2">
                <Show when={!isWelcome() && !isComplete()}>
                  <button
                    class="px-3 py-1.5 rounded-lg text-12-medium border border-border-weak-base hover:bg-bg-surface-hover transition-colors"
                    style={{ color: "var(--text-weak-base, #666)" }}
                    onClick={handlePrev}
                  >
                    {language.t("onboarding.button.prev")}
                  </button>
                </Show>
                <Show when={isWelcome()}>
                  <button
                    class="px-4 py-1.5 rounded-lg text-12-medium transition-colors"
                    style={{ background: "var(--bg-accent-subtle, #e0e7ff)", color: "var(--text-interactive-base, #4f46e5)" }}
                    onClick={handleNext}
                  >
                    {language.t("onboarding.button.start")}
                  </button>
                </Show>
                <Show when={!isWelcome() && !isComplete()}>
                  <button
                    class="px-4 py-1.5 rounded-lg text-12-medium transition-colors"
                    style={{ background: "var(--bg-accent-subtle, #e0e7ff)", color: "var(--text-interactive-base, #4f46e5)" }}
                    onClick={handleNext}
                  >
                    {language.t("onboarding.button.next")}
                  </button>
                </Show>
                <Show when={isComplete()}>
                  <button
                    class="px-4 py-1.5 rounded-lg text-12-medium transition-colors"
                    style={{ background: "var(--bg-accent-subtle, #e0e7ff)", color: "var(--text-interactive-base, #4f46e5)" }}
                    onClick={close}
                  >
                    {language.t("onboarding.button.done")}
                  </button>
                </Show>
              </div>
            </div>
            <Show when={!isWelcome() && !isComplete()}>
              <div class="mt-3 pt-3 border-t border-border-weaker-base text-11-regular text-text-weaker-base">
                {language.t("onboarding.step")} {stepIndex()}/{steps.length - 1}
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
