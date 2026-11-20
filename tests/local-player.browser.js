// Run with Playwright CLI. The launcher passes the player.html read from the npm archive.
async (page, html, folderPath) => {
  function check(condition, message) {
    if (!condition) throw new Error(message);
  }

  await page.setContent('<section id="panel"><iframe sandbox="allow-scripts"></iframe></section>');
  await page.evaluate((html) => {
    const frame = document.querySelector('iframe');
    frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; media-src blob:">' + html;
    window.messages = [];
    frame.addEventListener('load', () => {
      const { port1, port2 } = new MessageChannel();
      port1.onmessage = ({ data }) => window.messages.push(data);
      window.send = (id) => port1.postMessage({ type: 'action', id });
      window.barAction = (id, value) => port1.postMessage({ type: 'bottom-bar-action', id, value });
      frame.contentWindow.postMessage({ type: 'kem:init', capabilities: { bottomBar: 1 } }, '*', [port2]);
    }, { once: true });
  }, html);
  const menu = (id, label, enabled = true) => page.waitForFunction(({ id, label, enabled }) => {
    const items = window.messages.findLast((message) => message.type === 'menu')?.items;
    return items?.some((item) => item.id === id && item.label === label && item.enabled === enabled);
  }, { id, label, enabled });
  const caption = (text) => page.waitForFunction((text) =>
    window.messages.findLast((message) => message.type === 'caption')?.text === text, text);
  await menu('play', '播放', false);
  await caption(null);
  const frame = page.frames().find((frame) => frame.parentFrame());

  await frame.locator('#folder').setInputFiles(folderPath);
  await menu('play', '播放');
  check((await frame.locator('#track-list li button').allTextContents()).join() ===
    'Music/a/Song.wav,Music/b/Song.wav', 'Directory pairing or ordering failed');
  check(await frame.locator('#audio').evaluate((audio) => audio.paused && audio.src.startsWith('blob:')),
    'Folder selection should select, but not play, a local blob');

  check(await frame.locator('#inline-controls').isHidden(), 'Controls must move to the host bar');
  await page.waitForFunction(() => window.messages.findLast(m => m.type === 'bottom-bar')?.bar?.text === 'Song.wav');
  await page.evaluate(() => window.barAction('volume', 37));
  await page.waitForFunction(() => window.messages.findLast(m => m.type === 'bottom-bar')?.bar?.controls
    .some(control => control.id === 'volume' && control.value === 37));
  check(await frame.locator('#audio').evaluate((audio) => audio.volume) === 0.37, 'Volume failed');
  await page.evaluate(() => window.barAction('play'));
  await menu('play', '暂停');
  await page.evaluate(() => window.send('play'));
  await menu('play', '播放');
  await page.evaluate(() => window.send('lyrics'));
  await caption('Song.wav');
  for (const [time, text] of [[1.30, '甲'], [1.80, '乙'], [2.55, '甲']]) {
    await frame.locator('#audio').evaluate((audio, time) => { audio.currentTime = time; }, time);
    await caption(text);
  }
  await page.evaluate(() => { document.querySelector('#panel').hidden = true; window.send('play'); });
  await menu('play', '暂停');
  await caption('另一目录'); // The hidden player reached the end and advanced itself.
  await page.evaluate(() => window.barAction('next'));
  await caption('Song.wav'); // Wrap to the first track.
  await page.evaluate(() => window.send('lyrics'));
  await caption(null);
  await page.evaluate(() => { document.querySelector('#panel').hidden = false; window.send('lyrics'); });
  await menu('lyrics', '隐藏桌面歌词');
  check(await frame.locator('#track-list [aria-current=true]').textContent() === 'Music/a/Song.wav',
    'Returning to the panel should keep the current track');

  await frame.evaluate(() => {
    const original = URL.revokeObjectURL;
    window.revoked = [];
    URL.revokeObjectURL = (url) => { window.revoked.push(url); original(url); };
    window.dispatchEvent(new Event('pagehide'));
  });
  await page.waitForFunction(() => window.messages.findLast((message) => message.type === 'menu')?.items.length === 0);
  await caption(null);
  await page.waitForFunction(() => window.messages.findLast(m => m.type === 'bottom-bar')?.bar === null);
  check(await frame.locator('#audio').evaluate((audio) => audio.paused && !audio.hasAttribute('src') &&
    window.revoked.length === 1), 'Pagehide should release the current audio and object URL');
  return 'Sandboxed blob playback, volume, LRC pairing and timing, tray actions, hidden advance and cleanup passed';
}
