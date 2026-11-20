import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const archive = new URL("../dist/registry/-/tarballs/kem-local-player-1.1.0.tgz", import.meta.url);
const html = execFileSync("tar", ["-xOf", fileURLToPath(archive), "package/player.html"], { encoding: "utf8" });
const test = await readFile(new URL("./local-player.browser.js", import.meta.url), "utf8");
const output = new URL("../.cache/local-player-browser.js", import.meta.url);
const music = new URL("./player-browser-fixture/Music/", output);

// Four seconds of silent PCM, enough to cross each LRC timestamp in the browser.
const rate = 8000;
const wav = Buffer.alloc(44 + 4 * rate * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); // PCM format chunk size
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // Mono
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (const dir of ["a/", "b/"]) {
  await mkdir(new URL(dir, music), { recursive: true });
  await writeFile(new URL(`${dir}Song.wav`, music), wav);
}
await writeFile(new URL("a/Song.LRC", music), "[offset:+250]\n[00:01.50][00:02.75]甲\n[00:02.00]乙");
await writeFile(new URL("b/Song.lrc", music), "[00:00.00]另一目录");
await writeFile(new URL("a/skip.txt", music), "无音频");
const args = [html, fileURLToPath(music)].map((arg) => JSON.stringify(arg));
await writeFile(output, `(page) => (${test})(page, ${args.join(", ")})\n`);
console.log(fileURLToPath(output));
