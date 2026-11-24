// A frequency counter with a fixed number of slots, for "top paths" over logs with millions of
// distinct URLs. It is the Space-Saving algorithm (Metwally, Agrawal and El Abbadi, "Efficient
// Computation of Frequent and Top-k Elements in Data Streams", ICDT 2005): when every slot is
// taken, a new key replaces the key with the lowest count and inherits that count plus one.
// Guarantees, with n increments and m slots: any key seen more than n/m times holds a slot; a
// count is never lower than the true count and at most `overcount` higher; overcount <= n/m.
// The lowest count is kept at the root of a binary min-heap, so each increment is O(log m).

export interface TopEntry {
  key: string;
  /** An upper bound on how often the key was seen; exact when `overcount` is 0. */
  count: number;
  /** How much `count` may exceed the true count. */
  overcount: number;
}

/**
 * A copy of `text` that holds only its own characters. A slice of a log line can keep the whole
 * line (up to 64 KiB) alive; a key stored for the rest of the run must not.
 */
export const detach = (text: string): string => ` ${text}`.slice(1);

export class TopCounter {
  readonly capacity: number;
  readonly #heap: TopEntry[] = [];
  readonly #index = new Map<string, number>();

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** Slots in use; never more than `capacity`. */
  get size(): number {
    return this.#heap.length;
  }

  add(key: string): void {
    const heap = this.#heap;
    let i = this.#index.get(key);
    if (i !== undefined) {
      heap[i].count++;
    } else if (heap.length < this.capacity) {
      i = heap.length;
      key = detach(key);
      heap.push({ key, count: 1, overcount: 0 });
      this.#index.set(key, i);
      this.#siftUp(i);
      return;
    } else {
      const min = heap[0];
      this.#index.delete(min.key);
      key = detach(key);
      heap[0] = { key, count: min.count + 1, overcount: min.count };
      this.#index.set(key, 0);
      i = 0;
    }
    this.#siftDown(i);
  }

  /** The `n` highest counts, highest first; ties in key order so output is stable. */
  top(n: number): TopEntry[] {
    return [...this.#heap]
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, n)
      .map((e) => ({ ...e }));
  }

  #swap(a: number, b: number): void {
    const heap = this.#heap;
    [heap[a], heap[b]] = [heap[b], heap[a]];
    this.#index.set(heap[a].key, a);
    this.#index.set(heap[b].key, b);
  }

  #siftUp(i: number): void {
    const heap = this.#heap;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent].count <= heap[i].count) return;
      this.#swap(i, parent);
      i = parent;
    }
  }

  #siftDown(i: number): void {
    const heap = this.#heap;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < heap.length && heap[left].count < heap[smallest].count) smallest = left;
      if (right < heap.length && heap[right].count < heap[smallest].count) smallest = right;
      if (smallest === i) return;
      this.#swap(i, smallest);
      i = smallest;
    }
  }
}
