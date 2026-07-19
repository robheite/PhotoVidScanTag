import assert from "node:assert/strict";
import test from "node:test";

import { applyMediaSelection } from "../src/selection.ts";

const files = [
  { id: 1 },
  { id: 2 },
  { id: 3, missing: true },
  { id: 4 },
  { id: 5 }
];

test("plain click replaces selection and moves the anchor", () => {
  assert.deepEqual(applyMediaSelection([1, 2], 1, 4, files), {
    selectedIds: [4],
    anchorId: 4
  });
});

test("Command or Control click toggles one file", () => {
  assert.deepEqual(applyMediaSelection([1], 1, 4, files, { metaKey: true }), {
    selectedIds: [1, 4],
    anchorId: 4
  });
  assert.deepEqual(applyMediaSelection([1, 4], 4, 1, files, { ctrlKey: true }), {
    selectedIds: [4],
    anchorId: 1
  });
});

test("Shift click replaces selection with a contiguous non-missing range", () => {
  assert.deepEqual(applyMediaSelection([5], 1, 4, files, { shiftKey: true }), {
    selectedIds: [1, 2, 4],
    anchorId: 1
  });
});

test("Command-Shift click adds a range without duplicates", () => {
  assert.deepEqual(
    applyMediaSelection([5, 2], 2, 4, files, { metaKey: true, shiftKey: true }),
    { selectedIds: [5, 2, 4], anchorId: 2 }
  );
});

test("Shift click falls back to a plain click when the anchor is absent", () => {
  assert.deepEqual(applyMediaSelection([1, 2], 99, 5, files, { shiftKey: true }), {
    selectedIds: [5],
    anchorId: 5
  });
});

