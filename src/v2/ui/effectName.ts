import type { Placement } from "../domain";
import { getPreset } from "../registry";

/** The display name of an effect clip's preset ("Effect" when unknown). */
export const effectName = (p: Placement) => getPreset("videoEffect", p.effect?.preset)?.name ?? "Effect";
