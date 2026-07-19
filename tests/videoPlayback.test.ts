import assert from "node:assert/strict";
import test from "node:test";

import { describeVideoPlaybackError, playbackProgressMatchesJob } from "../src/videoPlayback.ts";

test("reports access or damage for media network errors", () => {
  assert.match(describeVideoPlaybackError(2), /unavailable, damaged, or blocked by file access/);
});

test("includes a known codec in decode and unsupported-source errors", () => {
  assert.match(describeVideoPlaybackError(3, undefined, "Apple ProRes 422 LT"), /Apple ProRes 422 LT/);
  assert.match(describeVideoPlaybackError(4, undefined, "Sony XAVC"), /Sony XAVC/);
});

test("preserves an unknown native media error message", () => {
  assert.equal(describeVideoPlaybackError(99, "Native failure"), "Native failure");
});

test("accepts progress only for the active conversion job", () => {
  assert.equal(playbackProgressMatchesJob("job-1", "job-1"), true);
  assert.equal(playbackProgressMatchesJob("job-1", "job-2"), false);
  assert.equal(playbackProgressMatchesJob(null, "job-1"), false);
});
