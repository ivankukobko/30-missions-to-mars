import { sleep } from './cdp.mjs';

export const SAVE = (seed, upto = 20) => `(()=>{
  const ranks={},points={};
  for(let i=1;i<=${upto};i++){ranks[i]='S';points[i]=95;}
  localStorage.setItem('mtm.progress.v1', JSON.stringify({
    seed:${seed},mastX:null,mastY:null,relayX:null,relayY:null,
    highestUnlocked:29,ranks,points,invertThrusters:false,
    mutedSfx:true,mutedMusic:true,startedAt:Date.now(),lastPlayed:Date.now(),archivedAt:null}));
  localStorage.setItem('mtm.prefs.v1', JSON.stringify({touchHintSeen:true,mutedSfx:true,mutedMusic:true}));
})()`;

/** Strip the debug furniture — it is a dev tool and must never reach a promo frame. */
export const clean = (b) => b.js(`document.querySelector('.debug-panel')?.remove()`);

export async function boot(b, seed, upto) {
  await b.goto('http://localhost:5173/');
  await b.js(SAVE(seed, upto));
  await b.goto('http://localhost:5173/?debug=1');
  await sleep(2500);
  await clean(b);
}

/**
 * enterMission → past the brief → control handed over.
 *
 * Two clicks per card, not one: `Brief.next` spends the first on finishing the teletype
 * and only advances on the second, so a one-click-per-card loop stalls on card one.
 * Polling `game.state` rather than counting clicks means the loop cannot mis-count.
 */
export async function fly(b, mission) {
  await b.js(`window.__mtm.game.enterMission(${mission})`);
  await sleep(3800);
  await clean(b);
  for (let i = 0; i < 40; i++) {
    const state = await b.js(`window.__mtm.game.state`);
    if (state !== 'BRIEF') return state;
    await clickSel(b, '#ui-layer button.primary');
    await sleep(220);
  }
  return 'stuck in BRIEF';
}

/** Straight to the last brief card, fully typed — what a transmission looks like to read. */
export async function briefCard(b, mission, page = 0) {
  await b.js(`window.__mtm.game.enterMission(${mission})`);
  await sleep(3800);
  await clean(b);
  for (let i = 0; i < page; i++) { await clickSel(b, '#ui-layer button.primary'); await sleep(200); await clickSel(b, '#ui-layer button.primary'); await sleep(400); }
  await clickSel(b, '#ui-layer button.primary'); // finish the typing, do not advance
  await sleep(500);
  await clean(b);
}

/** A trusted click at the element's centre. `.click()` is ignored by the brief's
 *  pointer handlers, which is the sort of thing only a real event dispatch fixes. */
export async function clickSel(b, sel) {
  const box = await b.js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()`);
  if (!box) return false;
  const { x, y } = JSON.parse(box);
  await b.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
  return true;
}

export const THRUST = ['ArrowUp', 38];
export const LEFT = ['ArrowLeft', 37];
export const RIGHT = ['ArrowRight', 39];
