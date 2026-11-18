import { copyFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const plugin = new URL("test-vault/.obsidian/plugins/curiosity-learning/", root);
const names = ["main.js", "manifest.json", "styles.css"];
const files = await Promise.all(names.map(name => readFile(new URL(name, root))));
await mkdir(plugin, { recursive: true });
for (const [index, name] of names.entries()) {
  const destination = new URL(name, plugin);
  await copyFile(new URL(name, root), destination);
  const installed = await readFile(destination);
  if (!files[index].equals(installed)) throw new Error("Copy mismatch: " + name);
  console.log(name, installed.length + " B", createHash("sha256").update(installed).digest("hex"));
}
