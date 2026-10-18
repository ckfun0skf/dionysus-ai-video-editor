export interface NormalizedFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function moveNormalizedFrame(frame: NormalizedFrame, dx: number, dy: number): NormalizedFrame {
  const width = clamp(frame.width, 2, 100);
  const height = clamp(frame.height, 2, 100);
  return {
    x: Math.round(clamp(frame.x + dx, 0, 100 - width) * 100) / 100,
    y: Math.round(clamp(frame.y + dy, 0, 100 - height) * 100) / 100,
    width,
    height
  };
}

/** Resize from a named corner while keeping the frame within the 0–100% canvas. */
export function resizeNormalizedFrame(frame: NormalizedFrame, handle: string, dx: number, dy: number, minSize = 2): NormalizedFrame {
  let left = frame.x, top = frame.y, right = frame.x + frame.width, bottom = frame.y + frame.height;
  const min = clamp(minSize, 1, 50);
  if (handle.includes("w")) left = clamp(frame.x + dx, 0, right - min);
  if (handle.includes("e")) right = clamp(frame.x + frame.width + dx, left + min, 100);
  if (handle.includes("n")) top = clamp(frame.y + dy, 0, bottom - min);
  if (handle.includes("s")) bottom = clamp(frame.y + frame.height + dy, top + min, 100);
  return {
    x: Math.round(left * 100) / 100,
    y: Math.round(top * 100) / 100,
    width: Math.round((right - left) * 100) / 100,
    height: Math.round((bottom - top) * 100) / 100
  };
}
