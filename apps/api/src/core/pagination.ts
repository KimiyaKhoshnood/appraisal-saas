import type { Page } from '@appraisal/contracts';

/**
 * Keyset pagination on UUIDv7 ids (time-ordered): stable under concurrent inserts and O(log n)
 * at any depth, unlike OFFSET. The page size is capped by the request schemas (T9).
 */
export function keysetArgs(limit: number, cursor: string | undefined, direction: 'asc' | 'desc' = 'desc') {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: direction },
  } as const;
}

export function toPage<T extends { id: string }, R = T>(rows: T[], limit: number, map?: (row: T) => R): Page<R> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: map ? items.map(map) : (items as unknown as R[]),
    nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
  };
}
