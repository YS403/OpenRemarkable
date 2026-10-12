/**
 * reMarkable orders a document's pages by short lowercase sort keys
 * ("ba", "bb", "bn", …) compared as strings. These helpers make keys that fall
 * between two existing ones, so pages can be inserted without moving others.
 */

const A = 97; // "a"
const BASE = 26;

/** A key strictly between `low` and `high` (either may be absent: open-ended). */
export function keyBetween(low: string | undefined, high: string | undefined): string {
  const lo = low ?? "";
  if (high !== undefined && !(lo < high)) throw new Error(`No key between "${lo}" and "${high}".`);
  let hi = high;
  let out = "";
  for (let i = 0; ; i++) {
    // `high` is a prefix of everything built so far, so nothing fits below it
    // (e.g. between "ba" and "baa": no letter sorts before "a")
    if (hi !== undefined && i >= hi.length) throw new Error(`No key between "${lo}" and "${high}".`);
    const dl = i < lo.length ? lo.charCodeAt(i) - A : 0;
    const dh = hi !== undefined ? hi.charCodeAt(i) - A : BASE;
    if (dl === dh) {
      out += String.fromCharCode(A + dl);
      continue;
    }
    // never end on "a": keys ending in the lowest letter leave no room below them later
    const mid = Math.floor((dl + dh) / 2);
    if (mid > dl) return out + String.fromCharCode(A + mid);
    // adjacent digits: keep the low digit, then anything above the rest of `low` works
    out += String.fromCharCode(A + dl);
    hi = undefined;
  }
}

/** `count` increasing keys between `low` and `high`. */
export function keysBetween(low: string | undefined, high: string | undefined, count: number): string[] {
  const keys: string[] = [];
  let previous = low;
  for (let i = 0; i < count; i++) {
    previous = keyBetween(previous, high);
    keys.push(previous);
  }
  return keys;
}
