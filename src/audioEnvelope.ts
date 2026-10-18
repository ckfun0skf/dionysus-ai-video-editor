/** Calculate normalized gain for one clip at a point in its local timeline. */
export function getAudioEnvelope(
  volume: number | undefined,
  fadeIn: number | undefined,
  fadeOut: number | undefined,
  elapsedSeconds: number,
  clipDuration: number
): number {
  if (!Number.isFinite(elapsedSeconds) || !Number.isFinite(clipDuration) || clipDuration <= 0 ||
      elapsedSeconds < 0 || elapsedSeconds >= clipDuration) return 0;
  const base = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume! : 1));
  const fadeInSeconds = Math.max(0, Number.isFinite(fadeIn) ? fadeIn! : 0);
  const fadeOutSeconds = Math.max(0, Number.isFinite(fadeOut) ? fadeOut! : 0);
  const elapsed = elapsedSeconds;
  const remaining = clipDuration - elapsed;
  const inGain = fadeInSeconds > 0 ? Math.min(1, elapsed / fadeInSeconds) : 1;
  const outGain = fadeOutSeconds > 0 ? Math.min(1, remaining / fadeOutSeconds) : 1;
  return base * inGain * outGain;
}

/** Update a clip duration without leaving persisted fade values outside the new range. */
export function withDurationAndClampedFades<T extends { duration: number; fadeIn?: number; fadeOut?: number }>(
  clip: T,
  duration: number
): T {
  return {
    ...clip,
    duration,
    ...(clip.fadeIn !== undefined ? { fadeIn: Math.max(0, Math.min(clip.fadeIn, duration)) } : {}),
    ...(clip.fadeOut !== undefined ? { fadeOut: Math.max(0, Math.min(clip.fadeOut, duration)) } : {})
  };
}
