export function describeVideoPlaybackError(code: number, nativeMessage?: string, codec?: string | null): string {
  switch (code) {
    case 1:
      return "Playback was stopped before the video finished loading.";
    case 2:
      return "The video could not be read. It may be unavailable, damaged, or blocked by file access.";
    case 3:
      return codec
        ? `${codec} could not be decoded by the embedded macOS browser for this file.`
        : "The video data could not be decoded by the embedded macOS browser.";
    case 4:
      return codec
        ? `${codec} is not supported by the embedded macOS browser for this file.`
        : "The video's codec or container is not supported by the embedded macOS browser.";
    default:
      return nativeMessage || "The embedded player reported an unknown media error.";
  }
}

export function playbackProgressMatchesJob(activeJobId: string | null, eventJobId: string): boolean {
  return Boolean(activeJobId && activeJobId === eventJobId);
}
