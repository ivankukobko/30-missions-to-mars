import { defineConfig } from 'vite';
import { parse } from 'yaml';

// `.yaml` imports as plain objects, parsed at build time — the locale files, `src/locales`.
// Parsing them in the page measured 10–20 ms a language in Node against under 1 ms for the
// same data as JSON, and a syntax slip in a hand-edited translation belongs in the build
// output rather than in a player's console. `missions.yaml` is imported with `?raw`, which
// puts a query on the id, so it never reaches this and keeps parsing where it always has.
// Emitted as `JSON.parse` of a string, which engines parse faster than an object literal.
function yamlModules() {
  return {
    name: 'yaml-modules',
    transform(source, id) {
      if (!id.endsWith('.yaml')) return null;
      const data = parse(source);
      return { code: `export default JSON.parse(${JSON.stringify(JSON.stringify(data))});`, map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [yamlModules()],
  // Plain `vite` ignores PORT — it only reacts to --port. `docker-compose.yml` always sets
  // it explicitly (`${PORT:-5173}`, matched to the same variable in its own port mapping,
  // so the two can never drift apart), and `.claude/launch.json`'s dev config leaves it
  // unpinned (autoPort) so concurrent sessions each get a free one instead of colliding.
  // 5173 here is only the fallback for the rare case nothing set it at all — a bare `vite`
  // from a terminal outside Docker — and matches Compose's own default for the same reason.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
});
