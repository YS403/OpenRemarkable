// Copy pdf.js's worker into public/ so the browser can load it as a static file.
// Runs before `dev` and `build`, keeping the worker in step with the installed pdfjs-dist.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const source = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "build", "pdf.worker.min.mjs");
const target = path.join(import.meta.dirname, "..", "public", "pdf.worker.min.mjs");
mkdirSync(path.dirname(target), { recursive: true });
copyFileSync(source, target);
