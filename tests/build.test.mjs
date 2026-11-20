import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const cache = join(root, ".cache");

test("the market build checks the client path, label and npm pack output", async (t) => {
  await mkdir(cache, { recursive: true });
  const fixture = await mkdtemp(join(await realpath(cache), "client-test-"));
  t.after(async () => {
    const resolved = await realpath(fixture);
    assert.equal(resolved, fixture);
    await rm(resolved, { recursive: true });
  });
  const release = join(fixture, "plugins", "test-client", "1.0.0");
  await mkdir(release, { recursive: true });
  await mkdir(join(fixture, "scripts"));
  await mkdir(join(fixture, "site"));
  await copyFile(join(root, "scripts", "build.mjs"), join(fixture, "scripts", "build.mjs"));
  await writeFile(join(fixture, "site", "index.html"), "<!doctype html>");
  await writeFile(join(release, "host.mjs"), "export default function () {}\n");
  await writeFile(join(release, "player.html"), "<!doctype html>\n");

  await writeFile(join(release, "empty.html"), "");
  await writeFile(join(release, "bad-encoding.html"), Uint8Array.of(0xff));
  const client = { entry: "./player.html", label: "播放器" };
  const cases = [
    ["traversal", { ...client, entry: "./../player.html" }, /invalid kem\.client/],
    ["external URL", { ...client, entry: "https://example.org/player.html" }, /invalid kem\.client/],
    ["blank label", { ...client, label: " " }, /invalid kem\.client/],
    ["missing file", { ...client, entry: "./missing.html" }, /must be a regular package file/],
    ["empty file", { ...client, entry: "./empty.html" }, /must be non-empty/],
    ["invalid UTF-8", { ...client, entry: "./bad-encoding.html" }, /must be UTF-8/],
    ["file excluded by npm", client, /npm pack omitted kem\.client\.entry/],
  ];
  assert.ok(process.env.npm_execpath, "Run tests with npm test");
  for (const [name, descriptor, message] of cases) {
    await t.test(name, async () => {
      await writeFile(join(release, "package.json"), JSON.stringify({
        name: "kem-test-client",
        version: "1.0.0",
        files: ["host.mjs"],
        kem: {
          id: "test-client",
          apiVersion: 1,
          host: "./host.mjs",
          title: "Fixture",
          description: "Market build client validation fixture.",
          client: descriptor,
        },
      }));
      const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
        cwd: fixture,
        encoding: "utf8",
        env: { ...process.env, MARKET_BASE_URL: "https://example.org/" },
      });
      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, message);
    });
  }
});
