// Fails when a tracked source or doc file contains a character the project style bans.
// Rules: no em dashes anywhere (use a comma, colon, parentheses or a plain hyphen instead), and
// no relative links in package READMEs, because npmjs.com renders them as broken links.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BANNED = [{ char: String.fromCharCode(0x2014), name: "em dash" }];
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "coverage"]);
const TEXT_EXT = /\.(ts|mts|cts|js|mjs|cjs|json|md|yml|yaml|txt)$/i;
const RELATIVE_LINK = /\]\((?!https?:|mailto:|#)[^)]*\)/;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(join(dir, entry.name));
    } else if (TEXT_EXT.test(entry.name)) {
      yield join(dir, entry.name);
    }
  }
}

const root = process.cwd();
const problems = [];
for (const file of walk(root)) {
  if (file.endsWith("init_prompt.md")) continue;
  const path = relative(root, file).split(sep).join("/");
  const checkLinks = path.startsWith("packages/") && path.endsWith("/README.md") && path.split("/").length === 3;
  let inCodeBlock = false;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    for (const { char, name } of BANNED) {
      if (line.includes(char)) problems.push(`${path}:${i + 1}: ${name}`);
    }
    if (line.trimStart().startsWith("```")) inCodeBlock = !inCodeBlock;
    if (checkLinks && !inCodeBlock && RELATIVE_LINK.test(line)) problems.push(`${path}:${i + 1}: relative link (use an absolute URL; npm can't resolve it)`);
  });
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log("check:text passed");
