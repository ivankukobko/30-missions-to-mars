import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { growGrid, buildColonyGrowth } from './ColonyGrowth.ts';

describe('growGrid', () => {
  it('is a pure function of its seed', () => {
    const a = growGrid(3, 8, 1, 12345);
    const b = growGrid(3, 8, 1, 12345);
    expect(b.cells).toEqual(a.cells);
    expect(b.tubes).toEqual(a.tubes);
  });

  it('gives a different grid on a different seed', () => {
    const a = growGrid(3, 8, 1, 1);
    const b = growGrid(3, 8, 1, 2);
    expect(b.cells).not.toEqual(a.cells);
  });

  it('always pins the anchor cell to room, regardless of seed', () => {
    for (let seed = 0; seed < 50; seed++) {
      const grid = growGrid(3, 8, 1, seed);
      expect(grid.cells[0][1]).toBe('room');
    }
  });

  it('never occupies a cell without support — below, or sideways off a room', () => {
    for (let seed = 0; seed < 50; seed++) {
      const grid = growGrid(4, 10, 2, seed * 97 + 3);
      for (let r = 1; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (grid.cells[r][c] === 'empty') continue;
          const inward = c === grid.anchorCol ? null : c < grid.anchorCol ? c + 1 : c - 1;
          const belowOccupied = grid.cells[r - 1][c] !== 'empty';
          const sideRoom = inward !== null && grid.cells[r][inward] === 'room';
          expect(belowOccupied || sideRoom, `seed ${seed} cell ${r},${c}`).toBe(true);
        }
      }
    }
  });

  it('keeps every room connected to the anchor through the corridor network', () => {
    // Rooms may only attach to the existing room network (the anchor counts), and
    // every adjacent room pair gets a tube — so a colonist can walk from any room to
    // any other, on every seed. Verified by flood fill over room adjacency.
    for (let seed = 0; seed < 50; seed++) {
      const grid = growGrid(5, 8, 2, seed * 31 + 7);
      const rooms = new Set<string>();
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (grid.cells[r][c] === 'room') rooms.add(`${r},${c}`);
        }
      }
      if (rooms.size === 0) continue; // anchor reserved in some hypothetical; nothing to check

      const seen = new Set<string>();
      const queue = ['0,' + grid.anchorCol];
      while (queue.length > 0) {
        const key = queue.pop()!;
        if (seen.has(key) || !rooms.has(key)) continue;
        seen.add(key);
        const [r, c] = key.split(',').map(Number);
        queue.push(`${r + 1},${c}`, `${r - 1},${c}`, `${r},${c + 1}`, `${r},${c - 1}`);
      }
      expect(seen.size, `seed ${seed}`).toBe(rooms.size);
    }
  });

  it('trends toward scaffold/empty and away from room as distance from the anchor grows', () => {
    const seeds = 60;
    let nearRooms = 0;
    let farRooms = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const grid = growGrid(5, 10, 2, seed * 31 + 7);
      // Row adjacent to the anchor vs. the far corner column of the top row.
      nearRooms += grid.cells[1][2] === 'room' ? 1 : 0;
      farRooms += grid.cells[9][0] === 'room' ? 1 : 0;
    }
    expect(nearRooms).toBeGreaterThan(farRooms);
  });

  it('only ever connects a room to an immediately adjacent room', () => {
    for (let seed = 0; seed < 30; seed++) {
      const grid = growGrid(4, 10, 2, seed * 53 + 11);
      for (const tube of grid.tubes) {
        expect(Math.abs(tube.dr) + Math.abs(tube.dc)).toBe(1); // exactly one step
        expect(grid.cells[tube.r][tube.c]).toBe('room');
        expect(grid.cells[tube.r + tube.dr][tube.c + tube.dc]).toBe('room');
      }
    }
  });

  it('connects every adjacent pair of rooms — a corridor is never missing, never extra', () => {
    for (let seed = 0; seed < 60; seed++) {
      const grid = growGrid(5, 10, 2, seed * 31 + 7);
      let expectedPairs = 0;
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (grid.cells[r][c] !== 'room') continue;
          if (r + 1 < grid.rows && grid.cells[r + 1][c] === 'room') expectedPairs++;
          if (c + 1 < grid.cols && grid.cells[r][c + 1] === 'room') expectedPairs++;
        }
      }
      expect(grid.tubes.length).toBe(expectedPairs);
    }
  });

  it('regression: an earlier hash correlation could silently zero out every corridor', () => {
    // The room/scaffold hash and (in an earlier version) the tube hash shared a
    // sin()-based formula whose salts turned out correlated — a tube gate driven off
    // one of them never fired once across 400 real seeds with real adjacent-room pairs
    // to connect. Corridors are unconditional now, so this specifically guards that a
    // wide, adjacency-rich grid actually produces at least one, not that the odds of
    // one firing are merely nonzero.
    const grid = growGrid(6, 4, 3, 1);
    let adjacentRoomPairs = 0;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        if (grid.cells[r][c] !== 'room') continue;
        if (r + 1 < grid.rows && grid.cells[r + 1][c] === 'room') adjacentRoomPairs++;
        if (c + 1 < grid.cols && grid.cells[r][c + 1] === 'room') adjacentRoomPairs++;
      }
    }
    expect(grid.tubes.length).toBe(adjacentRoomPairs);
    expect(grid.tubes.length).toBeGreaterThan(0);
  });
});

describe('growGrid — reserved cells (corridor-safety domain restriction)', () => {
  it('is always empty at a reserved cell, for every seed', () => {
    const reserved = (r: number, c: number) => r === 3 && c === 2;
    for (let seed = 0; seed < 60; seed++) {
      const grid = growGrid(5, 8, 0, seed, { reserved });
      expect(grid.cells[3][2]).toBe('empty');
    }
  });

  it('grows above a reserved cell only by reaching around it off a room', () => {
    // A reserved cell stops its own column — but lateral growth is allowed to wall the
    // reservation in from the side, which is deliberate: that is what turns a reserved
    // flight channel into a maze instead of open sky. So a cell directly above a
    // reserved one may exist, but only when its anchor-side neighbour is a room; it
    // can never be resting on the reserved cell itself.
    const reserved = (r: number, c: number) => r === 2 && c === 3;
    for (let seed = 0; seed < 40; seed++) {
      const grid = growGrid(5, 10, 0, seed, { reserved });
      expect(grid.cells[2][3]).toBe('empty');
      for (let r = 3; r < grid.rows; r++) {
        if (grid.cells[r][3] === 'empty') continue;
        const supported = grid.cells[r - 1][3] !== 'empty' || grid.cells[r][2] === 'room';
        expect(supported, `seed ${seed} row ${r}`).toBe(true);
      }
    }
  });

  it('reserving the anchor cell fails safe: that cell stays empty rather than being ' +
    'promoted to a room anyway, and nothing throws', () => {
    // What this does NOT claim: that reserving the anchor empties the whole grid. Row 0
    // has no column to its left or right to be supported by — only the column beneath a
    // cell matters — so a different, unreserved row-0 column is free to grow on its own
    // occupancy odds regardless of what happened to the anchor. The one guarantee that
    // has to hold is the reservation itself never loses to the anchor pin.
    const reserved = (r: number, c: number) => r === 0 && c === 2;
    for (let seed = 0; seed < 20; seed++) {
      const grid = growGrid(5, 6, 2, seed, { reserved });
      expect(grid.cells[0][2]).toBe('empty');
    }
  });

  it('never occupies any reserved cell — checked exhaustively, not at a hand-picked probe', () => {
    const reserved = (r: number, c: number) => (r + c) % 3 === 0;
    for (let seed = 0; seed < 25; seed++) {
      const grid = growGrid(6, 9, 3, seed, { reserved });
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (reserved(r, c)) expect(grid.cells[r][c]).toBe('empty');
        }
      }
    }
  });

  it('omitting reserved entirely is identical to passing a reservation that reserves nothing', () => {
    for (let seed = 0; seed < 20; seed++) {
      const withoutParam = growGrid(4, 8, 1, seed);
      const withNoOp = growGrid(4, 8, 1, seed, { reserved: () => false });
      expect(withNoOp.cells).toEqual(withoutParam.cells);
      expect(withNoOp.tubes).toEqual(withoutParam.tubes);
    }
  });
});

describe('growGrid — maturity', () => {
  it('maturity 0 never occupies anything beyond the anchor itself', () => {
    for (let seed = 0; seed < 40; seed++) {
      const grid = growGrid(5, 8, 2, seed, { maturity: 0 });
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (r === 0 && c === 2) continue; // the anchor itself, exempt
          expect(grid.cells[r][c]).toBe('empty');
        }
      }
    }
  });

  it('omitting maturity is identical to maturity 1 — fully mature, no gating', () => {
    for (let seed = 0; seed < 20; seed++) {
      const withoutParam = growGrid(4, 8, 1, seed);
      const explicit = growGrid(4, 8, 1, seed, { maturity: 1 });
      expect(explicit.cells).toEqual(withoutParam.cells);
    }
  });

  it('never occupies a cell farther from the anchor than maturity has reached, for any seed', () => {
    for (let seed = 0; seed < 30; seed++) {
      const maturity = 0.4;
      const grid = growGrid(6, 10, 3, seed, { maturity });
      const maxDist = grid.rows - 1 + Math.max(grid.anchorCol, grid.cols - 1 - grid.anchorCol);
      const reach = maturity * maxDist;
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          const dist = Math.abs(r) + Math.abs(c - grid.anchorCol);
          if (dist > reach) expect(grid.cells[r][c]).toBe('empty');
        }
      }
    }
  });
});

describe('growGrid — quality', () => {
  it('never occupies fewer cells at higher quality than lower, holding seed fixed', () => {
    // Provable, not just likely: occupyChance and roomChance are both monotonically
    // non-decreasing in quality, cells are decided in the same order against the same
    // hash rolls either way, and the support rule only ever *relaxes* — never
    // tightens — as more of the column below ends up occupied. So quality can't ever
    // cost a seed cells it already had.
    for (let seed = 0; seed < 60; seed++) {
      const low = growGrid(5, 8, 0, seed, { quality: 0 });
      const high = growGrid(5, 8, 0, seed, { quality: 1 });
      const occupied = (g: typeof low) => g.cells.flat().filter((c) => c !== 'empty').length;
      expect(occupied(high), `seed ${seed}`).toBeGreaterThanOrEqual(occupied(low));
    }
  });

  it('produces measurably more rooms at higher quality, aggregated across seeds', () => {
    let roomsAtLow = 0;
    let roomsAtHigh = 0;
    for (let seed = 0; seed < 60; seed++) {
      const low = growGrid(5, 8, 0, seed, { quality: 0 });
      const high = growGrid(5, 8, 0, seed, { quality: 1 });
      roomsAtLow += low.cells.flat().filter((c) => c === 'room').length;
      roomsAtHigh += high.cells.flat().filter((c) => c === 'room').length;
    }
    expect(roomsAtHigh).toBeGreaterThan(roomsAtLow);
  });

  it('omitting quality is identical to quality 0 — no bias, no change from today', () => {
    for (let seed = 0; seed < 20; seed++) {
      const withoutParam = growGrid(4, 8, 1, seed);
      const explicit = growGrid(4, 8, 1, seed, { quality: 0 });
      expect(explicit.cells).toEqual(withoutParam.cells);
    }
  });
});

describe('buildColonyGrowth — direction', () => {
  it('mirrors occupied cells across the anchor when direction flips sign', () => {
    // A single occupied column two cells out from the anchor, so its rendered x is
    // unambiguous — anchorCol 0, column 2, offset 2 cells.
    const grid = growGrid(3, 1, 0, 1, { maturity: 1, quality: 1 });
    // Force a deterministic, fully-occupied row regardless of what the seed rolled,
    // since this test is about placement, not about which cells grew.
    grid.cells[0] = ['room', 'room', 'room'];

    const scene = new THREE.Scene();
    const cellSize = 10;
    const east = buildColonyGrowth(scene, grid, { x: 100, y: 0, z: 0, cellSize, direction: 1 }, 'outpost');
    const west = buildColonyGrowth(scene, grid, { x: 100, y: 0, z: 0, cellSize, direction: -1 }, 'outpost');

    const xAt = (objs: THREE.Object3D[], targetX: number) =>
      objs.find((o) => Math.abs(o.position.x - targetX) < 0.01);

    // Column 2 sits 2 cells east of the anchor under direction +1, 2 cells west under -1.
    expect(xAt(east, 100 + 2 * cellSize)).toBeDefined();
    expect(xAt(west, 100 - 2 * cellSize)).toBeDefined();
    expect(xAt(east, 100 - 2 * cellSize)).toBeUndefined();
    expect(xAt(west, 100 + 2 * cellSize)).toBeUndefined();
  });
});
