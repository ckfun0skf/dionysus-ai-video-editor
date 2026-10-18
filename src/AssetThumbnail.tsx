import { AudioLines, Code2, Film } from "lucide-react";
import type { Asset, CompositionLayer } from "./types";
import { getAssetThumbnail } from "./mediaThumbnail";

type Props = { asset: Asset; assets: Asset[] };

function layerKind(layer: CompositionLayer) {
  return layer.kind === "procedural" || layer.kind === "script" ? "code" :
    layer.kind === "audio" ? "audio" :
    layer.kind === "video" || layer.kind === "image" ? "video" : "placeholder";
}

export default function AssetThumbnail({ asset, assets }: Props) {
  if (asset.kind === "clip") {
    const version = asset.clipVersions?.find(item => item.id === asset.selectedClipVersionId) ?? asset.clipVersions?.[0];
    const videoLayer = version?.layers.find(layer => layerKind(layer) === "video");
    const codeLayer = version?.layers.find(layer => layerKind(layer) === "code");
    const audioLayer = version?.layers.find(layer => layerKind(layer) === "audio");
    const mediaAsset = videoLayer?.assetId ? assets.find(item => item.id === videoLayer.assetId) : undefined;
    const thumbnail = mediaAsset ? mediaAsset.thumbnailPath ?? getAssetThumbnail(mediaAsset) : undefined;
    if (videoLayer && codeLayer) return <span className="asset-picker-thumb asset-picker-thumb-composite">
      <span className="asset-thumb-video">{thumbnail ? <img src={thumbnail} alt=""/> : <Film size={22}/>}</span>
      <span className="asset-thumb-code"><Code2 size={21}/></span>
      <span className="asset-thumb-splitter" aria-hidden="true">↔</span>
    </span>;
    if (codeLayer) return <span className="asset-picker-thumb"><Code2 size={26}/></span>;
    if (videoLayer) return <span className="asset-picker-thumb">{thumbnail ? <img src={thumbnail} alt=""/> : <span style={{ background: videoLayer.backgroundColor ?? "#17171d", width: "100%", height: "100%", display: "grid", placeItems: "center" }}><Film size={22}/></span>}</span>;
    if (audioLayer) return <span className="asset-picker-thumb"><AudioLines size={26}/></span>;
    return <span className="asset-picker-thumb" style={{ background: version?.layers[0]?.backgroundColor ?? "#17171d" }}/>;
  }
  if (asset.kind === "script") return <span className="asset-picker-thumb"><Code2 size={26}/></span>;
  if (asset.kind === "audio") return <span className="asset-picker-thumb"><AudioLines size={26}/></span>;
  if (asset.kind === "video" || asset.kind === "image") {
    const thumbnail = asset.thumbnailPath ?? getAssetThumbnail(asset);
    return <span className="asset-picker-thumb">{thumbnail ? <img src={thumbnail} alt=""/> : <Film size={26}/>}</span>;
  }
  return <span className="asset-picker-thumb"><Film size={26}/></span>;
}
