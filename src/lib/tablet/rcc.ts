/**
 * Writes a Qt binary resource file (`rcc --binary`, format version 3), so the
 * tablet app bundles can be built here instead of with Qt's rcc tool.
 *
 * Layout, all integers big-endian:
 *   header  "qres", u32 version, u32 tree offset, u32 data offset, u32 names offset, u32 flags
 *   data    per file: u32 size, bytes (stored uncompressed)
 *   names   per name: u16 length, u32 qtHash(name), UTF-16BE characters
 *   tree    22-byte nodes, breadth first from the root; a directory's children
 *           are consecutive and sorted by name hash (Qt binary-searches them):
 *             u32 name offset, u16 flags (2 = directory),
 *             directory: u32 child count, u32 first child index
 *             file:      u16 territory, u16 language, u32 data offset
 *             u64 last modified (ms, 0 here)
 */

const VERSION = 3;
const HEADER = 24;
const NODE = 22;
const DIRECTORY = 2;
/** QLocale::C, the "any locale" fallback rcc uses by default */
const LANGUAGE_C = 1;

export interface ResourceFile {
  /** path inside the resource, e.g. "ui/alarm.qml" */
  path: string;
  data: Uint8Array;
}

/** Qt's qt_hash over UTF-16 code units, as used for resource names. */
export function qtHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 4) + name.charCodeAt(i)) >>> 0;
    h = (h ^ ((h & 0xf0000000) >>> 23)) >>> 0;
    h &= 0x0fffffff;
  }
  return h;
}

interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: Map<string, Uint8Array>;
}

type Node = { kind: "dir"; name: string; dir: Dir } | { kind: "file"; name: string; data: Uint8Array };

export function buildRcc(files: ResourceFile[]): Uint8Array {
  const root: Dir = { name: "", dirs: new Map(), files: new Map() };
  for (const { path, data } of files) {
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) throw new Error(`Empty resource path: "${path}"`);
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let next = dir.dirs.get(part);
      if (!next) {
        next = { name: part, dirs: new Map(), files: new Map() };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    const leaf = parts[parts.length - 1];
    if (dir.files.has(leaf) || dir.dirs.has(leaf)) throw new Error(`Duplicate resource path: "${path}"`);
    dir.files.set(leaf, data);
  }

  const childrenOf = (dir: Dir): Node[] =>
    [
      ...[...dir.dirs.values()].map((d): Node => ({ kind: "dir", name: d.name, dir: d })),
      ...[...dir.files].map(([name, data]): Node => ({ kind: "file", name, data })),
    ].sort((a, b) => qtHash(a.name) - qtHash(b.name));

  // breadth-first numbering: each directory's children get consecutive indices
  const order: Node[] = [{ kind: "dir", name: "", dir: root }];
  const firstChild = new Map<Dir, number>();
  for (let i = 0; i < order.length; i++) {
    const node = order[i];
    if (node.kind !== "dir") continue;
    firstChild.set(node.dir, order.length);
    order.push(...childrenOf(node.dir));
  }

  // data and names blobs
  const dataParts: Uint8Array[] = [];
  const dataOffset = new Map<Node, number>();
  let dataSize = 0;
  const nameParts: Uint8Array[] = [];
  const nameOffset = new Map<string, number>();
  let namesSize = 0;
  for (const node of order.slice(1)) {
    if (!nameOffset.has(node.name)) {
      const entry = new Uint8Array(6 + node.name.length * 2);
      const view = new DataView(entry.buffer);
      view.setUint16(0, node.name.length);
      view.setUint32(2, qtHash(node.name));
      for (let i = 0; i < node.name.length; i++) view.setUint16(6 + i * 2, node.name.charCodeAt(i));
      nameOffset.set(node.name, namesSize);
      nameParts.push(entry);
      namesSize += entry.length;
    }
    if (node.kind === "file") {
      const size = new Uint8Array(4);
      new DataView(size.buffer).setUint32(0, node.data.length);
      dataOffset.set(node, dataSize);
      dataParts.push(size, node.data);
      dataSize += 4 + node.data.length;
    }
  }

  const dataStart = HEADER;
  const namesStart = dataStart + dataSize;
  const treeStart = namesStart + namesSize;
  const out = new Uint8Array(treeStart + order.length * NODE);
  const view = new DataView(out.buffer);
  out.set([0x71, 0x72, 0x65, 0x73]); // "qres"
  view.setUint32(4, VERSION);
  view.setUint32(8, treeStart);
  view.setUint32(12, dataStart);
  view.setUint32(16, namesStart);
  view.setUint32(20, 0); // no compressed entries

  let at = dataStart;
  for (const part of dataParts) {
    out.set(part, at);
    at += part.length;
  }
  for (const part of nameParts) {
    out.set(part, at);
    at += part.length;
  }

  order.forEach((node, index) => {
    const base = treeStart + index * NODE;
    view.setUint32(base, index === 0 ? 0 : nameOffset.get(node.name)!);
    if (node.kind === "dir") {
      const count = node.dir.dirs.size + node.dir.files.size;
      view.setUint16(base + 4, DIRECTORY);
      view.setUint32(base + 6, count);
      view.setUint32(base + 10, firstChild.get(node.dir)!);
    } else {
      view.setUint16(base + 4, 0);
      view.setUint16(base + 6, 0);
      view.setUint16(base + 8, LANGUAGE_C);
      view.setUint32(base + 10, dataOffset.get(node)!);
    }
    view.setBigUint64(base + 14, BigInt(0));
  });
  return out;
}

/** Reads a resource file written by buildRcc (or rcc, uncompressed) back into paths and bytes. */
export function readRcc(bytes: Uint8Array): ResourceFile[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "qres") throw new Error("Not a Qt resource file.");
  const tree = view.getUint32(8);
  const data = view.getUint32(12);
  const names = view.getUint32(16);
  const name = (offset: number) => {
    const length = view.getUint16(names + offset);
    let s = "";
    for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint16(names + offset + 6 + i * 2));
    return s;
  };
  const files: ResourceFile[] = [];
  const walk = (index: number, prefix: string) => {
    const base = tree + index * NODE;
    const flags = view.getUint16(base + 4);
    const path = index === 0 ? "" : `${prefix}${name(view.getUint32(base))}`;
    if (flags & DIRECTORY) {
      const count = view.getUint32(base + 6);
      const first = view.getUint32(base + 10);
      for (let k = 0; k < count; k++) walk(first + k, path ? `${path}/` : "");
    } else {
      const at = data + view.getUint32(base + 10);
      files.push({ path, data: bytes.slice(at + 4, at + 4 + view.getUint32(at)) });
    }
  };
  walk(0, "");
  return files;
}
