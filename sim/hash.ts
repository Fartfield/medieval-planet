// State hashing, for catching a desync on the tick it happens.
//
// Under lockstep a divergence is silent. Two clients keep simulating happily,
// each convinced it is right, and the players only notice minutes later when
// one of them watches a unit die that is still alive on the other screen. By
// then the cause is a hundred thousand ticks back and unrecoverable.
//
// So every client hashes its whole world each turn and ships 32 bits of it to
// the server, which compares. A mismatch names the exact turn -- and because
// the command log is the complete input to the simulation, that turn can be
// replayed offline as many times as it takes to find the cause. This is the
// single most valuable thing in the netcode and it costs almost nothing.

/** FNV-1a, 32 bit. Chosen for being a few integer ops with no lookup table. */
export class Hasher {
  private h = 0x811c9dc5;

  /**
   * Fold in one integer. A non-integer throws, because a float reaching the
   * hash means a float reached the state, which is the failure this whole
   * layer exists to prevent -- better to fail at the seam than to desync.
   */
  int(v: number): this {
    if (!Number.isInteger(v)) {
      throw new TypeError(`hash.int on a non-integer: ${v}`);
    }
    // Two words, so that values past 32 bits still contribute their high half.
    // Positions never get there; tick counts and entity ids eventually will.
    this.word(v | 0);
    this.word(Math.floor(v / 0x100000000) | 0);
    return this;
  }

  private word(v: number): void {
    let h = this.h;
    for (let i = 0; i < 4; i++) {
      h = Math.imul(h ^ ((v >>> (i * 8)) & 0xff), 0x01000193);
    }
    this.h = h >>> 0;
  }

  value(): number {
    return this.h >>> 0;
  }
}

export function hex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, '0');
}
