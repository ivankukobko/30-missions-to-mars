// Minimal CDP driver: launches Chrome, drives the game, writes PNGs straight to disk.
// Screenshot bytes never leave this process, which is the whole point of doing it here
// rather than round-tripping them through a tool result.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const PROFILE = '/tmp/mtm-shot-profile';

export async function launch({ width = 1920, height = 1080, dsf = 1 } = {}) {
  rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    `--window-size=${width},${height}`,
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=metal',
    '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=' + dsf,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let ws;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await r.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) { ws = page.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(250);
  }
  if (!ws) { chrome.kill(); throw new Error('Chrome did not expose a CDP page target'); }

  const sock = new WebSocket(ws);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const events = [];
  sock.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) events.push(msg);
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dsf, mobile: false,
  });

  return {
    send, events,
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(1500);
    },
    /** Runtime.evaluate that surfaces page-side exceptions instead of swallowing them. */
    async js(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
      return r.result?.value;
    },
    async key(code, keyCode, type) {
      await send('Input.dispatchKeyEvent', {
        type, code, key: code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
      });
    },
    async hold(code, keyCode, ms) {
      await this.key(code, keyCode, 'rawKeyDown');
      await sleep(ms);
      await this.key(code, keyCode, 'keyUp');
    },
    async shot(path) {
      const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true });
      mkdirSync(path.replace(/\/[^/]+$/, ''), { recursive: true });
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      return path;
    },
    close() { try { sock.close(); } catch {} chrome.kill(); },
  };
}
export { sleep };
