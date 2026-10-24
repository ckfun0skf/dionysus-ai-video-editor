/** Sticker helpers: wrap an SVG body in the standard 200 × 200 viewBox, and the palette the built-ins use. */
export const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400">${body}</svg>`;
export const RED = "#ff3b30", YEL = "#ffd60a";
