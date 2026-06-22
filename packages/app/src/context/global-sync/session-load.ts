import type { RootLoadArgs } from "./types"

export async function loadRootSessionsWithFallback(input: RootLoadArgs) {
  try {
    const query = { 
      directory: input.directory, 
      roots: true as const, 
      limit: input.limit,
      archived: false,
    }
    const result = await input.list(query)
    const rawCount = result.data?.length ?? 0
    return {
      data: result.data,
      limit: input.limit,
      rawCount,
      limited: rawCount >= input.limit,
    } as const
  } catch {
    const result = await input.list({ 
      directory: input.directory, 
      roots: true as const,
      archived: false,
    })
    const rawCount = result.data?.length ?? 0
    return {
      data: result.data,
      limit: input.limit,
      rawCount,
      limited: false,
    } as const
  }
}

export function estimateRootSessionTotal(input: { rawCount: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.rawCount
  return input.rawCount + 1
}
