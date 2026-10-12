/**
 * Ordering for the CRDT sequence that stores typed text in v6 pages.
 *
 * Each item names its left and right neighbours; (0, 0) on the left means
 * "start" and on the right means "end". A string item of length n owns the ids
 * counter … counter + n − 1, and later insertions may link to any of them, so
 * items are split into single characters before ordering.
 */

export interface CrdtIdLike {
  authorId: number;
  counter: number;
}

export interface SequenceItem<V> {
  itemId: CrdtIdLike;
  leftId: CrdtIdLike;
  rightId: CrdtIdLike;
  deletedLength: number;
  value: V | undefined;
}

/** One character (or deleted placeholder) after splitting. */
export interface CharItem {
  key: string;
  leftKey: string;
  rightKey: string;
  /** undefined for deleted characters */
  char: string | undefined;
}

export const idKey = (id: CrdtIdLike): string => `${id.authorId}:${id.counter}`;

const START = "^start";
const END = "^end";
const isZero = (id: CrdtIdLike) => id.authorId === 0 && id.counter === 0;

/** Split string and deleted items into one item per character id. */
export function splitIntoCharacters(items: readonly SequenceItem<string | number>[]): CharItem[] {
  const out: CharItem[] = [];
  for (const item of items) {
    // Numeric values are inline formatting markers and carry no characters.
    if (typeof item.value === "number") continue;
    const deleted = item.deletedLength > 0;
    const length = deleted ? item.deletedLength : (item.value ?? "").length;
    const { authorId, counter } = item.itemId;
    for (let i = 0; i < length; i++) {
      out.push({
        key: `${authorId}:${counter + i}`,
        leftKey: i === 0 ? (isZero(item.leftId) ? START : idKey(item.leftId)) : `${authorId}:${counter + i - 1}`,
        rightKey: i === length - 1 ? (isZero(item.rightId) ? END : idKey(item.rightId)) : `${authorId}:${counter + i + 1}`,
        char: deleted ? undefined : item.value![i],
      });
    }
  }
  return out;
}

function compareKeys(a: string, b: string): number {
  const [aa, ac] = a.split(":").map(Number);
  const [ba, bc] = b.split(":").map(Number);
  return aa - ba || ac - bc;
}

/**
 * Topologically order characters by their links (each comes after its left
 * neighbour and before its right one). Ties break by id for determinism.
 */
export function orderCharacters(items: readonly CharItem[]): CharItem[] {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const deps = new Map<string, Set<string>>();
  const depsOf = (key: string) => {
    let set = deps.get(key);
    if (!set) deps.set(key, (set = new Set()));
    return set;
  };
  for (const item of items) {
    depsOf(item.key).add(item.leftKey);
    depsOf(item.rightKey).add(item.key);
  }
  for (const set of [...deps.values()]) for (const dep of set) depsOf(dep);

  const ordered: CharItem[] = [];
  while (deps.size > 0) {
    const ready = [...deps].filter(([, d]) => d.size === 0).map(([k]) => k);
    if (ready.length === 0) throw new Error("Text sequence has a cycle.");
    for (const key of ready.sort(compareKeys)) {
      const item = byKey.get(key);
      if (item) ordered.push(item);
      deps.delete(key);
    }
    for (const set of deps.values()) for (const key of ready) set.delete(key);
  }
  return ordered;
}
