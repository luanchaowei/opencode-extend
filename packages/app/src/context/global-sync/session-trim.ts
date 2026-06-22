import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { cmp } from "./utils"

export function trimSessions(
  input: Session[],
  options: { limit: number; permission: Record<string, PermissionRequest[]>; now?: number },
) {
  const limit = Math.max(0, options.limit)
  const all = input
    .filter((s) => !!s?.id)
    .filter((s) => !s.time?.archived)
    .sort((a, b) => cmp(a.id, b.id))
  const roots = all.filter((s) => !s.parentID)
  const children = all.filter((s) => !!s.parentID)
  const keepRoots = roots.slice(0, limit)
  const keepRootIds = new Set(keepRoots.map((s) => s.id))
  const keepChildren = children.filter((s) => {
    if (s.parentID && keepRootIds.has(s.parentID)) return true
    const perms = options.permission[s.id] ?? []
    if (perms.length > 0) return true
    return false
  })
  return [...keepRoots, ...keepChildren].sort((a, b) => cmp(a.id, b.id))
}
