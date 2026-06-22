import { Tooltip as KobalteTooltip } from "@kobalte/core/tooltip"
import { createEffect, Match, onCleanup, splitProps, Switch, type JSX } from "solid-js"
import type { ComponentProps } from "solid-js"
import { createStore } from "solid-js/store"

export interface TooltipProps extends ComponentProps<typeof KobalteTooltip> {
  value: JSX.Element
  class?: string
  contentClass?: string
  contentStyle?: JSX.CSSProperties
  inactive?: boolean
  forceOpen?: boolean
  interactive?: boolean
}

export interface TooltipKeybindProps extends Omit<TooltipProps, "value"> {
  title: string
  keybind: string
}

export function TooltipKeybind(props: TooltipKeybindProps) {
  const [local, others] = splitProps(props, ["title", "keybind"])
  return (
    <Tooltip
      {...others}
      value={
        <div data-slot="tooltip-keybind">
          <span>{local.title}</span>
          {local.keybind && <span data-slot="tooltip-keybind-key">{local.keybind}</span>}
        </div>
      }
    />
  )
}

export function Tooltip(props: TooltipProps) {
  let triggerRef: HTMLDivElement | undefined
  let contentRef: HTMLDivElement | undefined
  const [state, setState] = createStore({
    open: false,
    block: false,
    expand: false,
    mouseInTrigger: false,
    mouseInContent: false,
  })
  const [local, others] = splitProps(props, [
    "children",
    "class",
    "contentClass",
    "contentStyle",
    "inactive",
    "forceOpen",
    "ignoreSafeArea",
    "value",
    "interactive",
  ])

  const close = () => setState("open", false)

  const inside = () => {
    const active = document.activeElement
    if (!triggerRef || !active) return false
    return triggerRef.contains(active)
  }

  const drop = (expand = state.expand) => {
    if (expand) return
    if (triggerRef?.matches(":hover")) return
    if (inside()) return
    setState("block", false)
  }

  const sync = () => {
    const expand = !!triggerRef?.querySelector('[aria-expanded="true"], [data-expanded]')
    setState("expand", expand)
    if (expand) {
      setState("block", true)
      close()
      return
    }
    drop(expand)
  }

  const arm = () => {
    setState("block", true)
    close()
  }

  const shouldStayOpen = () => {
    if (!local.interactive) return false
    return state.mouseInTrigger || state.mouseInContent
  }

  createEffect(() => {
    if (!triggerRef) return
    sync()
    const obs = new MutationObserver(sync)
    obs.observe(triggerRef, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "data-expanded"],
    })
    onCleanup(() => obs.disconnect())
  })

  let justClickedTrigger = false

  return (
    <Switch>
      <Match when={local.inactive}>{local.children}</Match>
      <Match when={true}>
        <KobalteTooltip
          gutter={4}
          {...others}
          closeDelay={local.interactive ? 300 : 0}
          ignoreSafeArea={local.ignoreSafeArea ?? true}
          open={local.forceOpen || state.open}
          onOpenChange={(open) => {
            if (local.forceOpen) return
            if (state.block && open) return
            if (justClickedTrigger) {
              justClickedTrigger = false
              return
            }
            if (!open && shouldStayOpen()) return
            setState("open", open)
          }}
        >
          <KobalteTooltip.Trigger
            ref={triggerRef}
            as={"div"}
            data-component="tooltip-trigger"
            class={local.class}
            onPointerDownCapture={(e: PointerEvent) => {
              if (local.interactive && state.open) return
              arm()
            }}
            onKeyDownCapture={(event: KeyboardEvent) => {
              if (event.key !== "Enter" && event.key !== " ") return
              arm()
            }}
            onPointerEnter={() => {
              if (local.interactive) setState("mouseInTrigger", true)
            }}
            onPointerLeave={() => {
              if (local.interactive) {
                setState("mouseInTrigger", false)
                setTimeout(() => {
                  if (!state.mouseInTrigger && !state.mouseInContent) close()
                }, 100)
              } else {
                if (!inside()) close()
                drop()
              }
            }}
            onFocusOut={() => requestAnimationFrame(() => drop())}
          >
            {local.children}
          </KobalteTooltip.Trigger>
          <KobalteTooltip.Portal>
            <KobalteTooltip.Content
              ref={contentRef}
              data-component="tooltip"
              data-placement={props.placement}
              data-force-open={local.forceOpen}
              class={local.contentClass}
              style={local.contentStyle}
              onPointerEnter={() => {
                if (local.interactive) {
                  setState("mouseInContent", true)
                  setState("open", true)
                }
              }}
              onPointerLeave={() => {
                if (local.interactive) {
                  setState("mouseInContent", false)
                  setTimeout(() => {
                    if (!state.mouseInTrigger && !state.mouseInContent) close()
                  }, 100)
                }
              }}
              onPointerDownOutside={(e: Event) => {
                if (local.interactive) return
                if (triggerRef === e.target || (e.target instanceof Node && triggerRef?.contains(e.target))) {
                  justClickedTrigger = true
                }
                e.preventDefault()
              }}
            >
              {local.value}
            </KobalteTooltip.Content>
          </KobalteTooltip.Portal>
        </KobalteTooltip>
      </Match>
    </Switch>
  )
}
