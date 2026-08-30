import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
