import { launch, sleep } from './cdp.mjs';
import { boot, fly, clean, THRUST } from './lib.mjs';

// Capsule art wants the world, not the instruments: the HUD in a store capsule reads as
// a screenshot someone forgot to crop. Rendered at each capsule's own aspect so the hero
// is a native 3840-wide frame rather than a 1920 upscale.
const PLATES = [
  ['plate-vista', 1920, 1080, 9, 250],
  ['plate-hero',  3840, 1240, 9, 260],
  ['plate-tall',   900, 1350, 9, 230],
  ['plate-cover', 1260, 1000, 9, 240],
];

const b = await launch();
try {
  await boot(b, 2016191401, 28);
  for (const [name, w, h, mission, height] of PLATES) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(600);
    const st = await fly(b, mission);
    if (st !== 'PLAYING') { console.log(name, 'SKIP', st); continue; }
    if (height > 200) {
      await b.js(`(()=>{const l=window.__mtm.lander();window.__mtm.place(l.x, ${height});})()`);
    } else {
      await b.js(`window.__mtm.overTarget(${height})`);
    }
    await sleep(400);
    await b.key(...THRUST, 'rawKeyDown');
    await sleep(700);
    await clean(b);
    await b.js(`document.getElementById('ui-layer').style.display='none'`);
    await sleep(120);
    await b.shot(new URL(`../art/${name}.png`, import.meta.url).pathname);
    await b.key(...THRUST, 'keyUp');
    await b.js(`document.getElementById('ui-layer').style.display=''`);
    console.log(name, w + 'x' + h, 'ok');
  }
} finally { b.close(); }
