import { useEffect, useMemo, useState } from "react";
import type { Asset } from "./types";
import { resolveMediaSource } from "./mediaAssetStore";

const EMPTY_ASSETS: Asset[] = [];
const EMPTY_IMAGE_REFERENCES: string[] = [];

type Props = {
  title: string;
  html?: string;
  css?: string;
  js?: string;
  style?: React.CSSProperties;
  assets?: Asset[];
  referencedImageAssetIds?: string[];
};

/** Renders user-authored clip code in an opaque-origin sandbox, isolated from the editor UI.
 * Only image assets explicitly referenced by this layer are exposed as window.DIONYSUS_IMAGES[id].
 */
export default function SandboxedCodePreview({ title, html = "", css = "", js = "", style, assets = EMPTY_ASSETS, referencedImageAssetIds = EMPTY_IMAGE_REFERENCES }: Props) {
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    const releases: Array<() => void> = [];
    const resolveImages = async () => {
      const entries = await Promise.all(referencedImageAssetIds.map(async assetId => {
        const asset = assets.find(item => item.id === assetId && item.kind === "image");
        if (!asset?.path) return undefined;
        const resolved = await resolveMediaSource(asset.path);
        if (!live) {
          resolved.release?.();
          return undefined;
        }
        if (resolved.release) releases.push(resolved.release);
        return [assetId, resolved.src] as const;
      }));
      if (live) setResolvedImages(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    };
    void resolveImages().catch(() => { if (live) setResolvedImages({}); });
    return () => {
      live = false;
      releases.forEach(release => release());
    };
  }, [assets, referencedImageAssetIds]);

  const srcDoc = useMemo(() => {
    const markup = html.trim() || '<canvas id="scene" style="display:block;width:100%;height:100%"></canvas>';
    const imageBootstrap = "window.DIONYSUS_IMAGES=Object.freeze(" + JSON.stringify(resolvedImages).replace(/</g, "\\u003c") + ");";
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent;color:#f4f4fa;font-family:system-ui,sans-serif}*{box-sizing:border-box} ${css}</style></head><body>${markup}<script>${imageBootstrap}\ntry{\n${js}\n}catch(e){const p=document.createElement('pre');p.style.cssText='position:absolute;inset:auto 8px 8px;color:#ff8d8d;background:#190d12;padding:8px;white-space:pre-wrap;font:12px monospace;max-height:45%;overflow:auto';p.textContent=String(e.stack||e);document.body.appendChild(p)}<\\/script></body></html>`;
  }, [html, css, js, resolvedImages]);

  return <iframe
    title={title + " code preview"}
    className="sandboxed-code-preview"
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
    srcDoc={srcDoc}
    style={style}
  />;
}
