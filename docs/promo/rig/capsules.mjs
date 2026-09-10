import { launch, sleep } from './cdp.mjs';
const DIR = (sub) => new URL(`../${sub}/`, import.meta.url).pathname.replace(/\/$/, '');

// name, w, h, layout, art, object-position
const FORMATS = [
  ['header-capsule-460x215',      460,  215,  'wide hdr', 'plate-vista.png', '54% 50%'],
  ['small-capsule-231x87',        231,   87,  'tiny',     'plate-vista.png', '54% 50%'],
  ['main-capsule-616x353',        616,  353,  'wide',     'plate-vista.png', '56% 50%'],
  ['vertical-capsule-374x448',    374,  448,  'tall',     'plate-tall.png',  '50% 30%'],
  ['library-capsule-600x900',     600,  900,  'tall',     'plate-tall.png',  '50% 35%'],
  ['library-header-920x430',      920,  430,  'wide',     'plate-vista.png', '56% 50%'],
  ['library-hero-3840x1240',     3840, 1240,  'hero',     'plate-hero.png',  '50% 50%'],
  ['page-background-1438x810',   1438,  810,  'pagebg',   'plate-vista.png', '50% 50%'],
  ['library-logo-1280x720',      1280,  720,  'logo',     'plate-vista.png', '50% 50%'],
  // itch.io. Its one required image, and the only one that is not a Steam size.
  ['cover-630x500',               630,  500,  'cover',    'plate-cover.png', '50% 38%', 'itch'],
];

const b = await launch();
try {
  for (const [name, w, h, layout, art, pos, sub = 'steam'] of FORMATS) {
    await b.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    // The library logo ships as a transparent PNG, so the page must not paint a ground.
    await b.send('Emulation.setDefaultBackgroundColorOverride',
      layout === 'logo' ? { color: { r: 0, g: 0, b: 0, a: 0 } } : { color: { r: 22, g: 11, b: 6, a: 1 } });
    const url = `http://localhost:8899/rig/capsule.html?layout=${encodeURIComponent(layout)}&art=${art}&pos=${encodeURIComponent(pos)}`;
    await b.send('Page.navigate', { url });
    await sleep(1100);
    await b.shot(`${DIR(sub)}/${name}.png`);
    console.log(name, w + 'x' + h);
  }
} finally { b.close(); }
