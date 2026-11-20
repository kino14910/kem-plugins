import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));

test("catalog releases use exact, integrity-checked tarballs under their registry", async () => {
  const index = await readJson(new URL("index.json", dist));
  assert.equal(index.format, 1);
  assert.ok(index.items.length);
  for (const item of index.items) {
    const packument = await readJson(new URL(`registry/${item.name}`, dist));
    assert.equal(packument.name, item.name);
    assert.equal(packument["dist-tags"].latest, item.versions[0].version);
    for (const target of item.versions) {
      const release = packument.versions[target.version];
      assert.equal(release.name, target.name);
      assert.equal(release.version, target.version);
      assert.equal(release.kem.id, target.id);
      assert.equal(release.kem.apiVersion, target.apiVersion);

      const archivePath = `-/tarballs/${target.name}-${target.version}.tgz`;
      const registry = new URL(target.registry);
      assert.equal(registry.protocol, "https:");
      assert.ok(registry.pathname.endsWith("/registry/"));
      assert.equal(release.dist.tarball, new URL(archivePath, registry).href);
      const archive = await readFile(new URL(`registry/${archivePath}`, dist));
      const digest = createHash("sha512").update(archive).digest("base64");
      assert.equal(release.dist.integrity, `sha512-${digest}`);
    }
  }
});


test("the local player npm archive contains the declared client and API v1 host", async () => {
  const index = await readJson(new URL("index.json", dist));
  const player = index.items.find(({ id }) => id === "local-player");
  assert.equal(player?.title, "本地播放器");
  assert.equal(player.name, "kem-local-player");
  assert.ok(player.versions.some(({ version }) => version === "1.0.0"));

  const packument = await readJson(new URL(`registry/${player.name}`, dist));
  const latest = player.versions[0].version;
  assert.equal(latest, "1.1.0");
  const archive = fileURLToPath(new URL(`registry/-/tarballs/${player.name}-${latest}.tgz`, dist));
  const readMember = (path) => execFileSync("tar", ["-xOf", archive, `package/${path}`], { encoding: "utf8" });
  const manifest = JSON.parse(readMember("package.json"));
  assert.equal(manifest.author, "kino");
  assert.equal(manifest.version, latest);
  assert.deepEqual(manifest.kem, packument.versions[latest].kem);
  assert.deepEqual(manifest.kem.client, { entry: "./player.html", label: "本地播放器" });
  const host = readMember(manifest.kem.host.slice(2));
  const plugin = await import(`data:text/javascript,${encodeURIComponent(host)}`);
  assert.equal(typeof plugin.default, "function");
  plugin.default({});
  const html = readMember(manifest.kem.client.entry.slice(2));
  assert.match(html, /<title>本地播放器<\/title>/);
  assert.match(html, /<script>\s*\(\(\) =>/);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=|<link\b|@import\b/i);
});
