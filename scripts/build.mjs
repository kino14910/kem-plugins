import { execFileSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL("..", import.meta.url)));
const plugins = join(root, "plugins");
const npmCli = process.env.npm_execpath;
const title = "KEM 插件市场";

function siteUrl(raw) {
  const url = raw && URL.parse(raw);
  // Match the Host's HTTPS registry path rules and retain the Pages project prefix.
  if (
    !url ||
    !/^https:\/\/[^/]/i.test(raw) ||
    /[\s\p{Cc}\p{Bidi_Control}\\?#]/u.test(raw) ||
    raw.slice(8).split("/", 1)[0].includes("@") ||
    !/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(url.pathname)
  ) {
    throw new Error(
      "Set MARKET_BASE_URL to the HTTPS site URL, e.g. https://example.github.io/kem-plugins/",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  if (new URL("registry/", url).href.length > 2048) throw new Error("MARKET_BASE_URL is too long");
  return url;
}

async function subdirectories(path) {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function validText(text, limit) {
  return (
    typeof text === "string" &&
    text.length <= limit &&
    text.trim() &&
    !/[\p{Cc}\p{Bidi_Control}]/u.test(text)
  );
}

async function validateClient(directory, client) {
  // Keep the market's checks in sync with the Host's API v1 client manifest.
  const { entry, label } = client ?? {};
  if (
    !client ||
    typeof client !== "object" ||
    Array.isArray(client) ||
    typeof entry !== "string" ||
    entry.length > 240 ||
    !entry.startsWith("./") ||
    !/\.html?$/i.test(entry) ||
    !validText(label, 80) ||
    /\p{Cf}/u.test(label)
  ) {
    throw new Error(`${directory}: invalid kem.client (expected a relative HTML entry and label)`);
  }
  const parts = entry.slice(2).split("/");
  if (parts.some((part) =>
    !part || /[. ]$|^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)|[\\:<>"|?*%#\p{Cc}]/iu.test(part)
  )) {
    throw new Error(`${directory}: invalid kem.client.entry path: ${entry}`);
  }
  const path = join(directory, ...parts);
  const stat = await lstat(path).catch((error) => {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error;
  });
  if (!stat?.isFile() || relative(path, await realpath(path)) !== "") {
    throw new Error(`${directory}: kem.client.entry must be a regular package file: ${entry}`);
  }
  if (!stat.size || stat.size > 2 * 1024 * 1024) {
    throw new Error(`${directory}: kem.client.entry must be non-empty and at most 2 MiB: ${entry}`);
  }
  const bytes = await readFile(path);
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${directory}: kem.client.entry must be UTF-8: ${entry}`);
  }
  if (!html.trim() || html.includes("\0")) {
    throw new Error(`${directory}: invalid kem.client HTML: ${entry}`);
  }
}

async function loadRelease(id, version) {
  const directory = join(plugins, id, version);
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const { name, kem } = manifest;
  if (
    typeof name !== "string" ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    name.length > 214 ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name) ||
    manifest.version !== version ||
    manifest.private === true ||
    kem?.id !== id ||
    kem.apiVersion !== 1 ||
    typeof kem.host !== "string" ||
    !/^\.\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.mjs$/.test(kem.host) ||
    !validText(kem.title, 120) ||
    !validText(kem.description, 1000)
  ) {
    throw new Error(`Invalid API v1 release manifest at ${directory}`);
  }
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "bundleDependencies",
    "bundledDependencies",
  ]) {
    if (Object.hasOwn(manifest, field))
      throw new Error(`${directory}: static registry plugins must have no ${field}`);
  }
  if (Object.hasOwn(kem, "client")) await validateClient(directory, kem.client);
  return { directory, manifest };
}

function pack({ directory, manifest }, tarballs) {
  const [archive] = JSON.parse(
    execFileSync(
      process.execPath,
      [
        npmCli,
        "pack",
        ".",
        "--json",
        "--ignore-scripts",
        "--offline",
        "--no-workspaces",
        "--cache",
        join(root, ".cache", "npm"),
        "--pack-destination",
        tarballs,
      ],
      { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ),
  );
  if (
    archive.name !== manifest.name ||
    archive.version !== manifest.version ||
    archive.filename !== `${manifest.name}-${manifest.version}.tgz` ||
    !archive.integrity?.startsWith("sha512-") ||
    !archive.shasum ||
    !archive.files.some((file) => file.path === manifest.kem.host.slice(2))
  ) {
    throw new Error(
      `npm pack did not produce the expected package and Host entry for ${directory}`,
    );
  }
  if (
    manifest.kem.client &&
    !archive.files.some((file) => file.path === manifest.kem.client.entry.slice(2))
  ) {
    throw new Error(`npm pack omitted kem.client.entry ${manifest.kem.client.entry} for ${directory}`);
  }
  return archive;
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function build(output, base) {
  const registry = new URL("registry/", base).href;
  // npm ci with --allow-remote=none requires registry tarballs under this URL prefix.
  const tarballs = join(output, "registry", "-", "tarballs");
  await mkdir(tarballs, { recursive: true });
  const items = [];
  const names = new Set();
  const ids = await subdirectories(plugins);
  if (ids.length === 0 || ids.length > 1000) throw new Error("Expected 1–1000 plugins");

  for (const id of ids) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new Error(`Invalid plugin ID directory: ${id}`);
    const versions = await subdirectories(join(plugins, id));
    if (versions.length === 0 || versions.length > 100)
      throw new Error(`${id}: expected 1–100 releases`);
    for (const version of versions) {
      if (
        !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
        !version.split(".").map(Number).every(Number.isSafeInteger)
      ) {
        throw new Error(`${id}: expected a stable X.Y.Z release directory, found ${version}`);
      }
    }
    versions.sort((a, b) => compareVersions(b, a));
    const [latest] = versions;
    const releases = await Promise.all(versions.map((version) => loadRelease(id, version)));
    const { name, kem } = releases[0].manifest;
    if (names.has(name) || releases.some(({ manifest }) => manifest.name !== name)) {
      throw new Error(`${id}: npm package name must be unique and stable across releases`);
    }
    names.add(name);

    const packument = { name, "dist-tags": { latest }, versions: {} };
    for (const release of releases) {
      const archive = pack(release, tarballs);
      packument.versions[archive.version] = {
        ...release.manifest,
        dist: {
          tarball: new URL(`-/tarballs/${archive.filename}`, registry).href,
          integrity: archive.integrity,
          shasum: archive.shasum,
        },
      };
    }
    // npm requests this literal path. Pages serves the full packument as a static file.
    await writeFile(join(output, "registry", name), json(packument));
    items.push({
      id,
      name,
      title: kem.title,
      description: kem.description,
      versions: versions.map((version) => ({ id, name, version, registry, apiVersion: 1 })),
    });
  }

  const index = json({ format: 1, title, items });
  if (Buffer.byteLength(index) > 4 * 1024 * 1024) throw new Error("Market index exceeds 4 MiB");
  await writeFile(join(output, "index.json"), index);
  await copyFile(join(root, "site", "index.html"), join(output, "index.html"));
}

async function removeBuildDirectory(path) {
  const stat = await lstat(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (!stat) return;
  const resolved = await realpath(path);
  if (!stat.isDirectory() || dirname(resolved) !== root || relative(path, resolved) !== "") {
    throw new Error(`Refusing to remove unexpected build directory: ${path}`);
  }
  await rm(resolved, { recursive: true });
}

const base = siteUrl(process.env.MARKET_BASE_URL);
if (!npmCli) throw new Error("Run this build with npm run build");
const stage = await mkdtemp(join(root, ".build-"));
const destination = join(root, "dist");
try {
  await build(stage, base);
  await removeBuildDirectory(destination);
  await rename(stage, destination);
} finally {
  await removeBuildDirectory(stage);
}
console.log(`Built ${destination}\nMarket source: ${new URL("index.json", base)}`);
