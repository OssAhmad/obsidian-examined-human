import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "module";
import { fileURLToPath } from "url";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: [fileURLToPath(new URL("src/main.ts", import.meta.url))],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "node:*",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  loader: {
    ".wasm": "binary",
    ".sql": "text",
  },
  outfile: "main.js",
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
