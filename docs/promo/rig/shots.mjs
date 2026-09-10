import { launch, sleep } from './cdp.mjs';
import { boot, fly, clean, clickSel, SAVE, THRUST } from './lib.mjs';

const OUT = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
const SEED = 2016191401;

async function clickText(b, text) {
  const box = await b.js(`(()=>{
    const e=[...document.querySelectorAll('#ui-layer *')].find(n=>n.children.length===0&&n.innerText&&n.innerText.trim().toUpperCase().startsWith(${JSON.stringify(text.toUpperCase())}));
    if(!e)return null;const r=e.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`);
  if (!box) return false;
  const { x, y } = JSON.parse(box);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  return true;
}

/** Pose over the target, light the engine, and hold the frame. */
async function pose(b, mission, height, name, burn = 750) {
  const st = await fly(b, mission);
  if (st !== 'PLAYING') { console.log(name, 'SKIP', st); return; }
  await b.js(`window.__mtm.overTarget(${height})`);
  await sleep(350);
  await b.key(...THRUST, 'rawKeyDown');
  await sleep(burn);
  await clean(b);
  await b.shot(`${OUT}/${name}.png`);
  await b.key(...THRUST, 'keyUp');
  console.log(name, 'ok');
}

const b = await launch();
try {
  // --- late campaign: the canyon the player has spent 28 deliveries filling in
  await boot(b, SEED, 28);
  await pose(b, 9, 25, '01-final-approach');
  await pose(b, 12, 30, '02-threading-the-corridor');
  await pose(b, 22, 55, '03-the-colony-you-built');

  // Entry: high above the rim, where every mission starts.
  {
    const st = await fly(b, 9);
    if (st === 'PLAYING') {
      await b.js(`(()=>{const l=window.__mtm.lander();window.__mtm.place(l.x, 250);})()`);
      await sleep(400);
      await b.key(...THRUST, 'rawKeyDown');
      await sleep(500);
      await clean(b);
      await b.shot(`${OUT}/04-entry.png`);
      await b.key(...THRUST, 'keyUp');
      console.log('04 ok');
    }
  }

  // A transmission, fully typed: the writing is half of what this game is.
  await b.js(`window.__mtm.game.enterMission(20)`);
  await sleep(3900);
  await clean(b);
  await clickSel(b, '#ui-layer button.primary');   // finish the teletype, do not advance
  await sleep(700);
  await clean(b);
  await b.shot(`${OUT}/05-transmission.png`);
  console.log('05 ok');

  // --- early campaign: the same canyon, four deliveries in
  await b.goto('http://localhost:5173/');
  await b.js(SAVE(SEED, 4));
  await b.goto('http://localhost:5173/?debug=1');
  await sleep(2500);
  await clean(b);
  await pose(b, 5, 45, '06-early-canyon');

  // Mission grid, from a plain load so there is no debug furniture on the page at all.
  await b.goto('http://localhost:5173/');
  await sleep(2600);
  await clickText(b, 'MISSIONS');
  await sleep(900);
  await b.shot(`${OUT}/07-missions.png`);
  console.log('07 ok');
} finally { b.close(); }
