/**
 * Third-party licences of what Crow HR ships: the production dependency closure of the server
 * image (apps/server), the web app bundle (apps/web) and the in-browser demo (apps/demo), with
 * every workspace package they pull in (packages/*). Reads the installed node_modules (run
 * `bun install` first); no network.
 *
 *   node scripts/third-party-notices.ts           # check: THIRD-PARTY-NOTICES.md is current (bun run licences:check)
 *   node scripts/third-party-notices.ts --write   # regenerate it (bun run licences)
 *
 * Fails on a copyleft or unknown licence (GPL, AGPL, LGPL, SSPL, EUPL, none, UNLICENSED, "SEE
 * LICENSE IN …", anything not in PERMISSIVE) unless the package is in ALLOWED below with a
 * reason. The output does not depend on the platform: platform-specific optional binaries
 * (packages with `os`/`cpu`/`libc` fields, such as @node-rs/argon2-linux-x64-musl) are not listed
 * one by one but named under their parent, and an installed one must carry its parent's licence.
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUTPUT = path.join(ROOT, "THIRD-PARTY-NOTICES.md");

/** Workspaces whose production closure ships, and the label used in the "Used in" column. */
const SHIPPED: { dir: string; label: string }[] = [
  { dir: "apps/server", label: "server" },
  { dir: "apps/web", label: "web" },
  { dir: "apps/demo", label: "demo" },
];

/**
 * Copyleft or unknown licences that were reviewed and accepted, by package name, with the reason.
 * Empty: nothing in the shipped closure needs an exception today.
 */
const ALLOWED: Record<string, string> = {};

/** Peer dependencies of our workspaces that are build tools: listed, but their own dependencies are not followed. */
const BUILD_TIME_PEERS: Record<string, string> = {
  tailwindcss: "build tool; only the CSS it generates (including its preflight styles) is in the web bundle",
};

const COPYLEFT = /^(A?GPL|LGPL|SSPL|EUPL)\b/i;

/**
 * SPDX identifiers known to be permissive. Anything else (a custom `LicenseRef-`, "SEE LICENSE IN",
 * a weak copyleft such as MPL-2.0, a typo) counts as unknown until someone reviews it: add it here
 * if it is permissive, or the package to ALLOWED with the reason.
 */
const PERMISSIVE = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "MIT-0",
  "OFL-1.1",
  "Python-2.0",
  "UFL-1.0",
  "Unlicense",
  "Zlib",
]);

interface Manifest {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: { type?: string }[];
  repository?: string | { url?: string; directory?: string };
  homepage?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
}

interface Entry {
  name: string;
  version: string;
  licence: string;
  repository: string;
  usedIn: Set<string>;
  platformPackages: Set<string>;
  note?: string;
}

const readManifest = (dir: string): Manifest => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

/** Node's lookup: `<dir>/node_modules/<name>`, then each parent directory's node_modules. */
function resolvePackage(fromDir: string, name: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const isWorkspace = (dir: string) =>
  dir.startsWith(ROOT + path.sep) && !dir.includes(`${path.sep}node_modules${path.sep}`);

function licenceOf(m: Manifest): string {
  if (typeof m.license === "string" && m.license.trim()) return m.license.trim();
  if (m.license && typeof m.license === "object" && m.license.type) return m.license.type;
  const legacy = (m.licenses ?? []).map((l) => l.type).filter(Boolean);
  if (legacy.length === 1) return legacy[0] as string;
  if (legacy.length > 1) return `(${legacy.join(" OR ")})`;
  return "UNKNOWN";
}

/** True when some alternative of an SPDX expression has only permissive terms. */
function isAcceptable(expression: string): boolean {
  const alternatives = expression.replace(/[()]/g, " ").split(/\s+OR\s+/i);
  return alternatives.some((alternative) =>
    alternative
      .split(/\s+AND\s+/i)
      .map((term) => term.trim())
      .every((term) => !COPYLEFT.test(term) && PERMISSIVE.has(term)),
  );
}

function repositoryOf(m: Manifest): string {
  const raw = typeof m.repository === "string" ? m.repository : m.repository?.url;
  const directory = typeof m.repository === "object" ? m.repository.directory : undefined;
  if (!raw) return m.homepage ?? `https://www.npmjs.com/package/${m.name}`;
  let url = raw.trim();
  const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/.exec(url);
  if (shorthand) {
    const host = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" }[shorthand[1] ?? "github"];
    url = `https://${host}/${shorthand[2]}`;
  }
  url = url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/#.*$/, "")
    .replace(/\.git$/, "");
  if (directory && /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(url)) url = `${url}/tree/HEAD/${directory}`;
  return url;
}

function collect(): { entries: Entry[]; problems: string[] } {
  const entries = new Map<string, Entry>();
  const problems: string[] = [];

  const visit = (dir: string, label: string, seen: Set<string>, isRoot: boolean) => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const m = readManifest(dir);
    const workspace = isWorkspace(dir);
    let entry: Entry | undefined;
    if (!workspace) {
      const key = `${m.name}@${m.version}`;
      entry = entries.get(key);
      if (!entry) {
        entry = {
          name: m.name,
          version: m.version,
          licence: licenceOf(m),
          repository: repositoryOf(m),
          usedIn: new Set(),
          platformPackages: new Set(),
        };
        entries.set(key, entry);
      }
      entry.usedIn.add(label);
    }
    const buildTimeNote = BUILD_TIME_PEERS[m.name];
    if (buildTimeNote && entry) {
      entry.note = buildTimeNote;
      return;
    }
    const required = { ...m.dependencies };
    // Our own workspaces' peers (react, react-dom, tailwindcss) ship with the app that installs them.
    if (workspace && !isRoot) Object.assign(required, m.peerDependencies);
    for (const name of Object.keys(required).sort()) {
      const found = resolvePackage(dir, name);
      if (!found) {
        problems.push(`${m.name}: dependency ${name} is not installed (run bun install).`);
        continue;
      }
      visit(found, label, seen, false);
    }
    for (const name of Object.keys(m.optionalDependencies ?? {}).sort()) {
      const found = resolvePackage(dir, name);
      const optional = found ? readManifest(found) : null;
      if (!optional || optional.os || optional.cpu || optional.libc) {
        // A platform-specific binary: which one is installed depends on the machine.
        entry?.platformPackages.add(name);
        if (optional && entry && licenceOf(optional) !== entry.licence) {
          problems.push(`${name} is licensed ${licenceOf(optional)}, not ${entry.licence} like ${m.name}.`);
        }
        continue;
      }
      visit(found as string, label, seen, false);
    }
  };

  for (const { dir, label } of SHIPPED) visit(path.join(ROOT, dir), label, new Set(), true);

  const sorted = [...entries.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version, "en") : a.name.localeCompare(b.name, "en"),
  );
  for (const e of sorted) {
    if (!isAcceptable(e.licence) && !ALLOWED[e.name]) {
      problems.push(
        `${e.name}@${e.version} is licensed "${e.licence}" (copyleft or not a reviewed permissive licence). Replace it; or, in scripts/third-party-notices.ts, add a permissive SPDX id to PERMISSIVE or the package to ALLOWED with the reason it is acceptable.`,
      );
    }
  }
  return { entries: sorted, problems };
}

const FONT_LICENCE_FILES = [
  { file: "packages/core/src/pdf/FONT-LICENSES.txt", title: "Azeret Mono and Ubuntu (PDF payslips and letters)" },
  {
    file: "packages/core/src/pdf/NOTO-SC-LICENSE.txt",
    title: 'Noto Sans SC, embedded as "Crow HR SC" (PDFs with Chinese text)',
  },
  { file: "packages/core/src/pdf/NOTO-TAMIL-LICENSE.txt", title: "Noto Sans Tamil (PDFs with Tamil text)" },
];

const cell = (text: string) => text.replace(/\|/g, "\\|");

function render(entries: Entry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) counts.set(e.licence, (counts.get(e.licence) ?? 0) + 1);
  const summary = [...counts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b, "en"))
    .map(([licence, n]) => `${licence} (${n})`)
    .join(", ");
  const allowed = entries.filter((e) => ALLOWED[e.name]);
  const notes = entries.filter((e) => e.platformPackages.size > 0 || e.note);

  const lines = [
    "# Third-party notices",
    "",
    "Crow HR is licensed under the [MIT licence](LICENSE). It ships with the open-source packages and fonts below, each under its own licence.",
    "",
    "<!-- Generated by scripts/third-party-notices.ts from the installed node_modules. Do not edit by hand: run `bun run licences`. `bun run check` fails when this file is out of date. -->",
    "",
    "## What is covered",
    "",
    "- **server**: the production dependencies of `apps/server` and the workspace packages it uses (`packages/core`, `packages/sg-rules`). They are in the Docker image under `/app/node_modules`, each package with its own licence file.",
    "- **web**: the dependencies of `apps/web` and `packages/ui`, bundled into the web app the server serves.",
    "- **demo**: the in-browser demo (`apps/demo`, `packages/demo`), which runs the web app and the core API in the browser.",
    "",
    "Development tools (test runners, linters, type checkers, Vite, the documentation site's Astro build) are not shipped and are not listed.",
    "",
    "The Docker image is built on the official `node:24-alpine` image (Node.js, MIT, with its bundled third-party licences in the Node.js distribution) and adds two Alpine packages: `postgresql17-client` (PostgreSQL Licence) for backups, and `tini` (MIT). Each published image also carries an SBOM with the full package list.",
    "",
    `Licences: ${summary}.`,
    "",
  ];
  if (allowed.length > 0) {
    lines.push("## Reviewed exceptions", "");
    for (const e of allowed) lines.push(`- \`${e.name}@${e.version}\` (${e.licence}): ${ALLOWED[e.name]}`);
    lines.push("");
  }
  lines.push(
    "## Packages",
    "",
    "| Package | Version | Licence | Used in | Repository |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const e of entries) {
    const usedIn = SHIPPED.map((s) => s.label)
      .filter((label) => e.usedIn.has(label))
      .join(", ");
    const repo = e.repository ? (e.repository.startsWith("https://") ? `<${e.repository}>` : cell(e.repository)) : "";
    lines.push(`| \`${e.name}\` | ${e.version} | ${cell(e.licence)} | ${usedIn} | ${repo} |`);
  }
  lines.push("");
  if (notes.length > 0) {
    lines.push("### Notes", "");
    for (const e of notes) {
      if (e.note) lines.push(`- \`${e.name}\`: ${e.note}.`);
      if (e.platformPackages.size > 0) {
        lines.push(
          `- \`${e.name}\` installs the one of its platform-specific binary packages that matches the machine (same project and licence): ${[
            ...e.platformPackages,
          ]
            .sort()
            .map((p) => `\`${p}\``)
            .join(", ")}.`,
        );
      }
    }
    lines.push("");
  }
  lines.push(
    "## Fonts",
    "",
    "- **Web app**: Azeret Mono (SIL Open Font License 1.1) and Ubuntu (Ubuntu Font Licence 1.0), from the `@fontsource/azeret-mono` and `@fontsource/ubuntu` packages listed above. Their licence texts are the same as the PDF fonts' below.",
    "- **PDFs** (payslips, letters): the same two fonts, plus Noto Sans SC and Noto Sans Tamil (SIL Open Font License 1.1) for Chinese and Tamil text, embedded in `packages/core/src/pdf/`.",
    "- **Mobile apps**: the same two fonts, with their licences in `apps/android/app/src/main/assets/licences/` and `apps/ios/CrowHR/Resources/Fonts/`.",
    "",
  );
  for (const { file, title } of FONT_LICENCE_FILES) {
    const text = readFileSync(path.join(ROOT, file), "utf8").replace(/\r\n/g, "\n").trimEnd();
    lines.push(`### ${title}`, "", `From \`${file}\`:`, "", "```text", text, "```", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

const { entries, problems } = collect();
if (problems.length > 0) {
  for (const p of problems) console.error(`licences: ${p}`);
  process.exit(1);
}
const expected = render(entries);
if (process.argv.includes("--write")) {
  writeFileSync(OUTPUT, expected);
  process.stdout.write(`Wrote THIRD-PARTY-NOTICES.md: ${entries.length} packages.\n`);
} else {
  const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, "utf8") : "";
  if (current !== expected) {
    console.error(
      "licences: THIRD-PARTY-NOTICES.md is out of date with the installed dependencies. Run `bun run licences` and commit it.",
    );
    process.exit(1);
  }
  process.stdout.write(
    `THIRD-PARTY-NOTICES.md is current: ${entries.length} packages, no copyleft or unknown licences.\n`,
  );
}
