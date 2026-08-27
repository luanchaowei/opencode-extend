import type { Mermaid } from "./mermaid-types"

export type { Mermaid }

export const MERMAID_PREFIX = "MERMAID_BLOCK_"

export function escapeTildes(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g)
  return parts.map((part, i) => {
    if (i % 2 === 1) return part
    return part.replace(/(?<!~)~(?!~)/g, "\\~")
  }).join("")
}
export const mermaidSvgStore = new Map<string, string>()

export function fixMermaidParens(code: string): string {
  return code
    .replace(/(\w+)\[([^\]]+)\]/g, (match, id: string, label: string) => {
      if (label.startsWith('"') || !/[()]/.test(label)) return match
      return `${id}["${label}"]`
    })
    .replace(/(\w+)\{([^\}]+)\}/g, (match, id: string, label: string) => {
      if (label.startsWith('"') || !/[()]/.test(label)) return match
      return `${id}{"${label}"}`
    })
}

export async function processMermaidBlocks(text: string, mermaidLib: Mermaid): Promise<string> {
  mermaidSvgStore.clear()
  let result = text
  let idx = 0

  for (;;) {
    const start = result.indexOf("```mermaid")
    if (start === -1) break
    const end = result.indexOf("```", start + 10)
    if (end === -1) break

    const fullBlock = result.substring(start, end + 3)
    let codeContent = result.substring(start + 10, end).trim()
    const placeholder = `${MERMAID_PREFIX}${idx}`
    idx++

    codeContent = fixMermaidParens(codeContent)

    try {
      const id = `mermaid-${Date.now()}-${idx}`
      const { svg } = await mermaidLib.render(id, codeContent)
      mermaidSvgStore.set(placeholder, svg)
      result = result.replace(fullBlock, placeholder)
    } catch {
      mermaidSvgStore.set(placeholder, `<div style="padding:8px;border:1px solid var(--border-critical-base);border-radius:4px;color:var(--text-diff-delete-base);font-size:13px;">Mermaid render error</div>`)
      result = result.replace(fullBlock, placeholder)
    }
  }

  return result
}

export function injectMermaidSvgs(wrapperRef: HTMLElement | undefined): boolean {
  if (!wrapperRef) return false
  if (mermaidSvgStore.size === 0) return true

  const markdownEl = wrapperRef.querySelector('[data-component="markdown"]')
  if (!markdownEl) return false

  const allText = markdownEl.textContent ?? ""
  let hasRemaining = false
  for (const [placeholder] of mermaidSvgStore) {
    if (allText.includes(placeholder)) hasRemaining = true
  }

  if (!hasRemaining) return true

  for (const [placeholder, svg] of mermaidSvgStore) {
    if (!allText.includes(placeholder)) continue

    const walker = document.createTreeWalker(markdownEl, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (!node.textContent?.includes(placeholder)) continue

      const parent = node.parentElement
      if (!parent) continue

      const wrapper = document.createElement("div")
      wrapper.className = "mermaid-diagram"
      wrapper.innerHTML = svg
      parent.replaceChild(wrapper, node)
      break
    }
  }

  return !hasRemaining
}
