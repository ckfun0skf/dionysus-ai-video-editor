import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, CheckCircle2, ChevronDown, CircleHelp, Clapperboard, Clock3, Code2, Download, FileJson, Film, FolderOpen, Layers3, Maximize2, Plus, Save, Settings2, ShieldCheck, Sparkles, SquarePlay, Upload, WandSparkles, Undo2, Redo2 } from "lucide-react";
import { sampleProject } from "./sampleProject";
import type { Asset, AssetKind, ClipVersion, CompositionLayer, DionysusProject, ReferenceProfile, ReferenceRole, Shot, TimelineClip } from "./types";
import { validateProject } from "./projectValidation";
import { moveNormalizedFrame, resizeNormalizedFrame } from "./previewTransform";
import { getAllowedChildClipAssets, wouldCreateClipAssetCycle } from "./clipAssetGraph";
import { t } from "./i18n";
import { duplicateTimelineClip, moveTimelineClip, splitTimelineClip, trimTimelineClip, unlinkTimelineAudio, deleteTimelineClip } from "./timelineOperations";
import { recordProjectChange, undoProjectChange as undoHistory, redoProjectChange as redoHistory } from "./projectHistory";
import { collectCompositionLayers, renderCompositionFrame, exportCompositionWebM, downloadExport } from "./compositionRenderer";
import AIGenerationPanel from "./AIGenerationPanel";
import CodePlayground from "./CodePlayground";
import ClipAssetEditor from "./ClipAssetEditor";
import AssetThumbnail from "./AssetThumbnail";
import SandboxedCodePreview from "./SandboxedCodePreview";
import { deleteStoredMediaAsset, isStoredMediaPath, loadMediaBlobFromPath, resolveMediaSource, storeMediaAsset } from "./mediaAssetStore";
import { createImageThumbnail, createVideoThumbnail, getAssetThumbnail } from "./mediaThumbnail";
import { getAudioEnvelope, withDurationAndClampedFades } from "./audioEnvelope";
import { getMasterShotIndexAtTime, getMasterShotStart, getMasterShotStarts, getMasterTimelineDuration, rippleReorderMasterShots, setMasterShotDuration, setMasterShotStart } from "./masterTimeline";
import StoryboardFlowCanvas from "./StoryboardFlowCanvas";
import AgentStoryboardModal from "./AgentStoryboardModal";
import ProductionChecklistDrawer from "./ProductionChecklistDrawer";
type View = "storyboard" | "timeline" | "assets" | "references";
type VersionTimelineTab = { id: string; shotId: string; slotId: string; versionId: string; label: string; assetId?: string };
type PreviewTransformKind = "track" | "clip" | "layer";
type PreviewTransformDraft = { key: string; x: number; y: number; width: number; height: number };
type PreviewTransformStart = PreviewTransformDraft & {
  id: string; kind: PreviewTransformKind; mode: "move" | "resize"; handle: string;
  pointerId: number; startX: number; startY: number; frameWidth: number; frameHeight: number;
  tab?: VersionTimelineTab;
};
const STORAGE_KEY = "dionysus.project.v1";
const id = (prefix: string) => prefix + "-" + crypto.randomUUID();
const time = (s: number) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const copy = (p: DionysusProject) => JSON.parse(JSON.stringify(p)) as DionysusProject;

function normalizeLegacyTimelineTracks(project: DionysusProject): DionysusProject {
  const legacyTracks = project.tracks.filter(track => track.kind === "procedural" || track.kind === "effects");
  if (legacyTracks.length === 0) return project;

  const tracks = project.tracks.filter(track => track.kind !== "procedural" && track.kind !== "effects");
  let videoTrack = tracks.find(track => track.kind === "video");
  if (!videoTrack) {
    const legacyVideoTrack = legacyTracks.find(track => track.kind === "procedural");
    if (legacyVideoTrack) {
      videoTrack = { ...legacyVideoTrack, kind: "video", name: "Video 1" };
      tracks.push(videoTrack);
    }
  }

  const legacyTrackIds = new Set(legacyTracks.map(track => track.id));
  const timelineClips = (project.timelineClips ?? []).map(clip =>
    legacyTrackIds.has(clip.trackId) && videoTrack
      ? { ...clip, trackId: videoTrack.id }
      : clip
  );
  return { ...project, tracks, timelineClips };
}
function findNonOverlappingClipStart(clips: TimelineClip[], movingId: string, trackId: string, desiredStart: number, duration: number, timelineDuration: number, fps: number) {
  const maxStart = Math.max(0, timelineDuration - duration);
  const snapped = Math.max(0, Math.min(maxStart, Math.round(desiredStart * fps) / fps));
  const others = clips.filter(clip => clip.trackId === trackId && clip.id !== movingId).sort((a, b) => a.start - b.start);
  const candidates = [snapped, 0, ...others.flatMap(clip => [clip.start - duration, clip.start + clip.duration])]
    .map(start => Math.round(start * fps) / fps)
    .filter(start => start >= 0 && start <= maxStart);
  const valid = candidates.filter(start => others.every(clip => start + duration <= clip.start + 0.0001 || start >= clip.start + clip.duration - 0.0001));
  return (valid.length ? valid : [snapped]).sort((a, b) => Math.abs(a - snapped) - Math.abs(b - snapped))[0];
}


function AudioWaveform({ path }: { path?: string }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    let context: AudioContext | null = null;
    if (!path || typeof AudioContext === "undefined") {
      setPeaks(null);
      return;
    }
    void loadMediaBlobFromPath(path)
      .then(blob => blob.arrayBuffer())
      .then(buffer => {
        if (cancelled) return null;
        context = new AudioContext();
        return context.decodeAudioData(buffer);
      })
      .then(decoded => {
        if (!decoded || cancelled) return;
        const channel = decoded.getChannelData(0);
        const bars = 56;
        const size = Math.max(1, Math.floor(channel.length / bars));
        const next = Array.from({ length: bars }, (_, index) => {
          const start = index * size;
          const end = Math.min(channel.length, start + size);
          let peak = 0;
          for (let sample = start; sample < end; sample += 1) peak = Math.max(peak, Math.abs(channel[sample]));
          return Math.max(0.08, Math.min(1, peak));
        });
        setPeaks(next);
        void context?.close();
      })
      .catch(() => { if (!cancelled) setPeaks(null); });
    return () => { cancelled = true; if (context && context.state !== "closed") void context.close(); };
  }, [path]);
  return <div className={"audio-waveform"+(!path?" placeholder":peaks?" decoded":" loading")} aria-hidden="true">
    {peaks ? peaks.map((peak,index)=><i key={index} style={{height:(Math.max(3,peak*100))+"%"}}/>) : <span/>}
  </div>;
}

export default function App() {
  const [project, setProject] = useState<DionysusProject>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeLegacyTimelineTracks(copy(sampleProject));
      const parsed: unknown = JSON.parse(raw);
      return validateProject(parsed) ? normalizeLegacyTimelineTracks(parsed) : normalizeLegacyTimelineTracks(copy(sampleProject));
    } catch { return normalizeLegacyTimelineTracks(copy(sampleProject)); }
  });
  const [undoStack, setUndoStack] = useState<DionysusProject[]>([]);
  const [redoStack, setRedoStack] = useState<DionysusProject[]>([]);
  const projectRef = useRef(project);
  const undoStackRef = useRef(undoStack);
  const redoStackRef = useRef(redoStack);
  projectRef.current = project;
  undoStackRef.current = undoStack;
  redoStackRef.current = redoStack;
  const lastHistoryGroup = useRef("");
  const lastHistoryAt = useRef(0);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectSettingsWidth, setProjectSettingsWidth] = useState(project.width);
  const [projectSettingsHeight, setProjectSettingsHeight] = useState(project.height);
  const [projectSettingsFrameRate, setProjectSettingsFrameRate] = useState(project.frameRate);
  const [projectSettingsAspect, setProjectSettingsAspect] = useState<"16:9" | "9:16" | "4:3" | "1:1" | "21:9" | "custom">("custom");
  const [projectSettingsResolution, setProjectSettingsResolution] = useState("custom");
  const [view, setView] = useState<View>("storyboard");
  const [editorTime, setEditorTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackTimeRef = useRef(0);
  const previewImagesRef = useRef(new Map<string, HTMLImageElement>());
  const previewVideosRef = useRef(new Map<string, HTMLVideoElement>());
  const previewMediaReleasesRef = useRef(new Map<string, () => void>());
  const [previewAssetId, setPreviewAssetId] = useState("");
  const [showPreviewOverlay, setShowPreviewOverlay] = useState(false);
  const previewTransformRef = useRef<PreviewTransformStart | null>(null);
  const [previewTransformDraft, setPreviewTransformDraft] = useState<PreviewTransformDraft | null>(null);
  const previewCanvasRefs = useRef(new Map<string, HTMLCanvasElement>());
  const previewRenderId = useRef(0);
  const previewImage = previewAssetId === "__none__" ? undefined : project.assets.find(asset => asset.id === previewAssetId && asset.kind === "image" && Boolean(asset.path)) ?? project.assets.find(asset => asset.kind === "image" && Boolean(asset.path));
  const editorTimeLabel = (seconds: number) => `${time(seconds)}.${String(Math.floor((seconds % 1) * 100)).padStart(2, "0")}`;
  const [selectedId, setSelectedId] = useState(project.shots[0]?.id ?? "");
  const [notice, setNotice] = useState(t("status.localOnlyNotice"));
  const fileInput = useRef<HTMLInputElement>(null);
  const assetFileInput = useRef<HTMLInputElement>(null);
  const [showAssetCreateMenu, setShowAssetCreateMenu] = useState(false);
  const [assetUploadKind, setAssetUploadKind] = useState<"all" | "audio" | "image">("all");
  const [codeAssetEditorOpen, setCodeAssetEditorOpen] = useState(false);
  const [clipAssetEditorOpen, setClipAssetEditorOpen] = useState(false);
  const [assetPickerTrackId, setAssetPickerTrackId] = useState("");
  const [assetPickerSearch, setAssetPickerSearch] = useState("");
  const [assetPickerFilter, setAssetPickerFilter] = useState<"all" | "video" | "code" | "audio">("all");
  const [assetPickerSort, setAssetPickerSort] = useState<"created" | "modified" | "name">("name");
  const [codeAssetDraft, setCodeAssetDraft] = useState({ name: "New code asset", html: "<main>Build something here</main>", css: "body { font-family: system-ui; display: grid; place-items: center; min-height: 100vh; }", js: "console.log(\"Ready to create\");" });

  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState("");
  const [profileDraftType, setProfileDraftType] = useState<ReferenceProfile["entityType"]>("character");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [referenceAssetId, setReferenceAssetId] = useState("");
  const [referenceRole, setReferenceRole] = useState<ReferenceRole>("identity");
  const [selectedSlotId, setSelectedSlotId] = useState<string>("");
  const [expandedVersionShotId, setExpandedVersionShotId] = useState<string>("");
  const [selectedTimelineClipId, setSelectedTimelineClipId] = useState<string>("");
  const [timelineTabs, setTimelineTabs] = useState<VersionTimelineTab[]>([]);
  const [activeTimelineTabId, setActiveTimelineTabId] = useState("master");
  const [timelineTabTimes, setTimelineTabTimes] = useState<Record<string, number>>({ master: 0 });
  const [shotContextMenuId, setShotContextMenuId] = useState<string>("");
  const [shotContextMenuPosition, setShotContextMenuPosition] = useState({ x: 0, y: 0 });
  const [shotSettingsId, setShotSettingsId] = useState<string>("");
  const [videoTrackSettingsId, setVideoTrackSettingsId] = useState<string>("");
  const [genericTrackSettingsId, setGenericTrackSettingsId] = useState<string>("");
  const [compositionLayerSettingsId, setCompositionLayerSettingsId] = useState<string>("");
  const [nestedLayerContextMenuId, setNestedLayerContextMenuId] = useState<string>("");
  const [nestedLayerContextMenuPosition, setNestedLayerContextMenuPosition] = useState({ x: 0, y: 0 });
  const clipResizeRef = useRef<{ id: string; edge: "left" | "right"; pointerId: number; x: number; start: number; duration: number; laneWidth: number } | null>(null);
  const [clipResizePreview, setClipResizePreview] = useState<{ id: string; start: number; duration: number } | null>(null);
  const shotResizeRef = useRef<{ id: string; edge: "left" | "right"; pointerId: number; x: number; start: number; duration: number; laneWidth: number } | null>(null);
  const [shotResizePreview, setShotResizePreview] = useState<{ id: string; start: number; duration: number } | null>(null);
  const clipDragSourceRef = useRef<TimelineClip | null>(null);
  const [clipDropPreview, setClipDropPreview] = useState<{ trackId: string; start: number; duration: number; name: string } | null>(null);
  const [timelineClipSettingsId, setTimelineClipSettingsId] = useState<string>("");
  const [clipContextMenuId, setClipContextMenuId] = useState<string>("");
  const [clipContextMenuPosition, setClipContextMenuPosition] = useState({ x: 0, y: 0 });
  const [trackContextMenuId, setTrackContextMenuId] = useState<string>("");
  const [trackContextMenuPosition, setTrackContextMenuPosition] = useState({ x: 0, y: 0 });
  const [showAddLayerMenu, setShowAddLayerMenu] = useState(false);
  const [selectedTimelineTrackId, setSelectedTimelineTrackId] = useState<string>("");
  const [selectedCompositionLayerId, setSelectedCompositionLayerId] = useState<string>("");
  const [collapsedVideoTrackIds, setCollapsedVideoTrackIds] = useState<string[]>([]);
  const [rippleReorderMode, setRippleReorderMode] = useState(false);
  const [storyboardMode, setStoryboardMode] = useState<"flow" | "list">("flow");
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [isChecklistOpen, setIsChecklistOpen] = useState(false);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: new Date().toISOString() })); }
    catch { setNotice(t("notice.storageFull")); }
  }, [project]);
  useEffect(() => {
    function handleHistoryShortcut(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "d" && event.shiftKey && selectedId && selectedSlotId) {
        event.preventDefault();
        duplicateSlot(selectedId, selectedSlotId);
        return;
      }
      if (key === "d" && !event.shiftKey && selectedId) {
        event.preventDefault();
        duplicateShot(selectedId);
        return;
      }
      if (key !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redoProjectChange();
      else undoProjectChange();
    }
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [undoStack, redoStack, project, selectedId]);
  const selected = project.shots.find(s => s.id === selectedId) ?? project.shots[0];
  const runtime = useMemo(() => Math.max(getMasterTimelineDuration(project.shots), ...(project.timelineClips ?? []).map(clip => clip.start + clip.duration)), [project.shots, project.timelineClips]);
  const mediaTimelineDuration = useMemo(() => Math.max(runtime, 10, ...(project.timelineClips ?? []).map(clip => clip.start + clip.duration)), [runtime, project.timelineClips]);
  const activeVersionTimelineTab = timelineTabs.find(tab => tab.id === activeTimelineTabId);
  const activeVersionTimelineClipAsset = activeVersionTimelineTab?.assetId
    ? project.assets.find(asset => asset.id === activeVersionTimelineTab.assetId && asset.kind === "clip")
    : undefined;
  const activeVersionTimelineShot = activeVersionTimelineTab && !activeVersionTimelineTab.assetId
    ? project.shots.find(shot => shot.id === activeVersionTimelineTab.shotId)
    : undefined;
  const activeVersionTimelineSlot = activeVersionTimelineTab && !activeVersionTimelineTab.assetId
    ? activeVersionTimelineShot?.slots.find(slot => slot.id === activeVersionTimelineTab.slotId)
    : undefined;
  const activeVersionTimeline = activeVersionTimelineTab
    ? activeVersionTimelineClipAsset?.clipVersions?.find(version => version.id === activeVersionTimelineTab.versionId)
      ?? activeVersionTimelineSlot?.versions.find(version => version.id === activeVersionTimelineTab.versionId)
    : undefined;
  const activeTimelineDuration = activeVersionTimeline ? activeVersionTimeline.duration : runtime;
  const activeShotInfo = useMemo(() => {
    const index = getMasterShotIndexAtTime(project.shots, editorTime);
    return { shot: project.shots[index] ?? project.shots[0], index: Math.max(0, index) };
  }, [project.shots, editorTime]);
  useEffect(() => {
    if (!isPlaying) { playbackTimeRef.current = editorTime; return; }
  }, [editorTime, isPlaying]);
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0, previous = 0, lastPublished = 0;
    const interval = 1000 / Math.max(1, Math.min(24, project.frameRate || 24));
    const tick = (now: number) => {
      if (!previous) previous = now;
      playbackTimeRef.current += (now - previous) / 1000;
      previous = now;
      if (playbackTimeRef.current >= activeTimelineDuration) {
        playbackTimeRef.current = activeTimelineDuration;
        setEditorTime(activeTimelineDuration);
        setIsPlaying(false);
        return;
      }
      if (now - lastPublished >= interval) { lastPublished = now; setEditorTime(playbackTimeRef.current); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, activeTimelineDuration, project.frameRate]);
  useEffect(() => {
    const canvas = previewCanvasRefs.current.get(activeTimelineTabId);
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    const renderId = ++previewRenderId.current;
    const allLayers = activeVersionTimeline ? activeVersionTimeline.layers : collectCompositionLayers(project);
    const layers = allLayers.length
      ? allLayers.filter(layer => editorTime >= layer.start && editorTime < layer.start + layer.duration)
      : !activeVersionTimeline && previewImage ? [{ id: "editor-image-fallback", name: previewImage.name, kind: "image" as const, start: 0, duration: Math.max(runtime, 0.1), assetId: previewImage.id, fitMode: "contain" as const, x: 0, y: 0, width: 100, height: 100 }]
      : [];
    const render = async () => {
      const frame = document.createElement("canvas");
      const releases = previewMediaReleasesRef.current;
      try {
        const compositionPath = activeVersionTimelineTab?.id === activeTimelineTabId && activeVersionTimelineTab.assetId
          ? new Set([activeVersionTimelineTab.assetId])
          : new Set<string>();
        const previewScale = Math.min(1280 / Math.max(1, project.width), 720 / Math.max(1, project.height));
        const previewDimensions = { width: Math.max(1, Math.round(project.width * previewScale)), height: Math.max(1, Math.round(project.height * previewScale)) };
        await renderCompositionFrame(frame, project, layers, editorTime, previewDimensions, previewImagesRef.current, previewVideosRef.current, releases, compositionPath);
        if (renderId !== previewRenderId.current) return;
        const context = canvas.getContext("2d");
        if (context) {
          canvas.width = frame.width;
          canvas.height = frame.height;
          context.drawImage(frame, 0, 0);
        }
      } catch {
        if (renderId === previewRenderId.current) {
          const context = canvas.getContext("2d");
          if (context) { context.fillStyle = "#000"; context.fillRect(0, 0, canvas.width, canvas.height); }
        }
      }
    };
    void render();
    return () => { if (previewRenderId.current === renderId) previewRenderId.current += 1; };
  }, [project, editorTime, previewImage, runtime, view, activeVersionTimeline, activeTimelineTabId]);
  useEffect(() => () => {
    previewMediaReleasesRef.current.forEach(release => release());
    previewMediaReleasesRef.current.clear();
    previewVideosRef.current.forEach(video => { video.pause(); video.removeAttribute("src"); });
    previewVideosRef.current.clear();
    previewImagesRef.current.clear();
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    let cancelled = false, frame = 0, warned = false;
    const players = new Map<string, { element: HTMLMediaElement; release?: () => void }>();
    const clips = (activeVersionTimeline ? activeVersionTimeline.layers : collectCompositionLayers(project))
      .filter(layer => layer.kind === "audio" && Boolean(layer.assetId))
      .map(layer => ({ ...layer, kind: "audio" as const, linkedVideoClipId: undefined }));
    const prepare = async () => {
      for (const clip of clips) {
        const asset = project.assets.find(item => item.id === clip.assetId);
        if (!asset?.path || (asset.kind !== "audio" && !(clip.linkedVideoClipId && asset.kind === "video"))) continue;
        try {
          const source = await resolveMediaSource(asset.path);
          if (cancelled) { source.release?.(); continue; }
          const media: HTMLMediaElement = asset.kind === "video" ? document.createElement("video") : document.createElement("audio");
          if (source.remote) media.crossOrigin = "anonymous";
          media.src = source.src; media.preload = "auto"; media.volume = 1;
          if (media instanceof HTMLVideoElement) { media.playsInline = true; media.muted = false; }
          players.set(clip.id, { element: media, release: source.release });
        } catch { if (!cancelled) setNotice("Could not load audio source: " + asset.name + ". Re-import or relink the media."); }
      }
    };
    const sync = () => {
      if (cancelled) return;
      const seconds = playbackTimeRef.current;
      for (const clip of clips) {
        const player = players.get(clip.id); if (!player) continue;
        const media = player.element;
        if (clip.muted) { if (!media.paused) media.pause(); continue; }
        if (seconds >= clip.start && seconds < clip.start + clip.duration) {
          const sourceTime = (clip.sourceIn ?? 0) + seconds - clip.start;
          if (media.readyState >= 1 && Math.abs(media.currentTime - sourceTime) > 0.35) { try { media.currentTime = Math.max(0, sourceTime); } catch { /* wait for media metadata */ } }
          media.volume = getAudioEnvelope(clip.volume, clip.fadeIn, clip.fadeOut, seconds - clip.start, clip.duration);
          if (media.paused) void media.play().catch(() => { if (!cancelled && !warned) { warned = true; setNotice("Audio playback was blocked by the browser. Press Play again to retry."); } });
        } else if (!media.paused) media.pause();
      }
      frame = requestAnimationFrame(sync);
    };
    void prepare().then(() => { if (!cancelled) frame = requestAnimationFrame(sync); });
    return () => { cancelled = true; cancelAnimationFrame(frame); players.forEach(player => { player.element.pause(); player.element.removeAttribute("src"); player.release?.(); }); players.clear(); };
  }, [isPlaying, project, activeVersionTimeline]);

  const renderTimelinePreview = (
    tabKey: string,
    title: string,
    subtitle: string,
    duration: number,
    overlayTitle: string,
    overlaySubtitle: string,
    allowClearImage = false
  ) => (
    <section className="integrated-preview-panel" aria-label={title}>
      <div className="integrated-preview-heading">
        <div><strong>{title}</strong><small>{subtitle}</small></div>
        <span className="integrated-timecode">{editorTimeLabel(editorTime)} / {editorTimeLabel(duration)}</span>
      </div>
      <div className="integrated-preview-frame" style={{aspectRatio: Math.max(1,project.width) + " / " + Math.max(1,project.height)}}>
        <canvas
          ref={element => {
            if (element) previewCanvasRefs.current.set(tabKey, element);
            else previewCanvasRefs.current.delete(tabKey);
          }}
          className="editor-preview-canvas"
          aria-label={title + " at " + editorTimeLabel(editorTime)}
        />
        {(tabKey === "master" ? collectCompositionLayers(project) : activeVersionTimelineTab?.id === tabKey ? activeVersionTimeline?.layers ?? [] : []).filter(layer => (layer.kind === "procedural" || layer.kind === "script") && editorTime >= layer.start && editorTime < layer.start + layer.duration && (layer.html !== undefined || layer.css !== undefined || layer.code !== undefined)).map(layer => <SandboxedCodePreview
          key={layer.id}
          title={layer.name}
          html={layer.html}
          css={layer.css}
          js={layer.code}
          assets={project.assets}
          referencedImageAssetIds={layer.referencedImageAssetIds}
          style={{left:(layer.x??0)+"%",top:(layer.y??0)+"%",width:(layer.width??100)+"%",height:(layer.height??100)+"%",zIndex:1}}
        />)}
        {view === "timeline" && (()=>{const layer=activeVersionTimeline?.layers.find(item=>item.id===selectedCompositionLayerId);const clip=(project.timelineClips??[]).find(item=>item.id===selectedTimelineClipId&&item.kind!=="audio");const track=project.tracks.find(item=>item.id===selectedTimelineTrackId);const target=layer??clip??track;const kind:PreviewTransformKind=layer?"layer":clip?"clip":"track";if(!target||(!layer&&!clip&&!selectedTimelineTrackId))return null;const key=kind+":"+target.id;const tab=kind==="layer"?activeVersionTimelineTab:undefined;const fallbackTrack=clip?project.tracks.find(item=>item.id===clip.trackId):undefined;const x=target.x??fallbackTrack?.x??0;const y=target.y??fallbackTrack?.y??0;const width=target.width??fallbackTrack?.width??100;const height=target.height??fallbackTrack?.height??100;const geometry=previewTransformDraft?.key===key?previewTransformDraft:{key,x,y,width,height};return <div className="selected-layer-frame" role="group" aria-label={target.name+" preview transform"} style={{left:geometry.x+"%",top:geometry.y+"%",width:geometry.width+"%",height:geometry.height+"%",touchAction:"none"}} onPointerDown={event=>startPreviewTransform(event,{id:target.id,kind,x,y,width,height,key,tab})} onPointerMove={movePreviewTransform} onPointerUp={finishPreviewTransform} onPointerCancel={finishPreviewTransform}><span>{target.name}</span><i data-handle="nw" aria-label="Resize top left" className="layer-frame-handle top-left"/><i data-handle="ne" aria-label="Resize top right" className="layer-frame-handle top-right"/><i data-handle="sw" aria-label="Resize bottom left" className="layer-frame-handle bottom-left"/><i data-handle="se" aria-label="Resize bottom right" className="layer-frame-handle bottom-right"/></div>;})()}
        {showPreviewOverlay && <div className="integrated-preview-overlay">
          <span>PREVIEW OVERLAY</span><strong>{overlayTitle}</strong><small>{overlaySubtitle || "No shot description"}</small>
        </div>}
      </div>
      <div className="integrated-preview-controls">
        <button className="button button-quiet button-small" onClick={() => { setIsPlaying(false); setEditorTime(0); playbackTimeRef.current = 0; }} title="Go to start">|◀</button>
        <button className="button button-primary button-small" aria-label={isPlaying ? "Pause preview" : "Play preview"} onClick={() => { if (!isPlaying && editorTime >= duration) { playbackTimeRef.current = 0; setEditorTime(0); } setIsPlaying(value => !value); }}>{isPlaying ? "Pause" : "Play"}</button>
        <button className="button button-quiet button-small" onClick={() => { setIsPlaying(false); const next = Math.min(duration, editorTime + 0.5); setEditorTime(next); playbackTimeRef.current = next; }}>+0.5s</button>
        <label>Playhead <input aria-label="Timeline playhead time" type="range" min="0" max={Math.max(duration, 0.1)} step="0.05" value={Math.min(editorTime, duration)} onChange={event => { setIsPlaying(false); const next = Number(event.target.value); setEditorTime(next); playbackTimeRef.current = next; }} /></label>
        <button className="button button-quiet button-small" aria-pressed={showPreviewOverlay} onClick={() => setShowPreviewOverlay(value => !value)}>{showPreviewOverlay ? "Hide overlay" : "Overlay"}</button>
        {allowClearImage && previewImage && <button className="button button-quiet button-small" onClick={() => setPreviewAssetId("__none__")}>Clear image</button>}
      </div>
    </section>
  );

  const selectedStart = useMemo(() => getMasterShotStart(project.shots, selectedId), [project.shots, selectedId]);
  const slotCount = project.shots.reduce((n, s) => n + s.slots.length, 0);
  function change(fn: (p: DionysusProject) => DionysusProject, historyGroup = "") {
    const now = Date.now();
    const current = projectRef.current;
    const currentUndo = undoStackRef.current;
    const coalesce = Boolean(historyGroup) && historyGroup === lastHistoryGroup.current && now - lastHistoryAt.current < 800;
    if (!coalesce) {
      const history = recordProjectChange({ current: copy(current), undo: currentUndo, redo: redoStackRef.current }, copy(current));
      undoStackRef.current = history.undo.map(copy);
      setUndoStack(undoStackRef.current);
    }
    lastHistoryGroup.current = historyGroup;
    lastHistoryAt.current = now;
    redoStackRef.current = [];
    setRedoStack([]);
    const next = { ...fn(copy(current)), updatedAt: new Date().toISOString() };
    projectRef.current = next;
    setProject(next);
  }
  function openProjectSettings() {
    const current = projectRef.current;
    const ratio = current.width / current.height;
    const known: Array<["16:9" | "9:16" | "4:3" | "1:1" | "21:9", number]> = [
      ["16:9", 16/9], ["9:16", 9/16], ["4:3", 4/3], ["1:1", 1], ["21:9", 21/9]
    ];
    const match = known.find(([, value]) => Math.abs(ratio - value) < 0.015);
    setProjectSettingsAspect(match?.[0] ?? "custom");
    setProjectSettingsWidth(current.width);
    setProjectSettingsHeight(current.height);
    setProjectSettingsFrameRate(current.frameRate);
    setProjectSettingsResolution([[3840,2160],[2560,1440],[1920,1080],[1080,1920],[1080,1080],[1280,720]]
      .some(([width,height])=>width===current.width&&height===current.height)
      ? current.width+"x"+current.height : "custom");
    setProjectSettingsOpen(true);
  }

  function updateProjectSettingsAspect(value: "16:9" | "9:16" | "4:3" | "1:1" | "21:9" | "custom") {
    setProjectSettingsAspect(value);
    if (value === "custom") return;
    const ratios: Record<Exclude<typeof value, "custom">, number> = {
      "16:9":16/9, "9:16":9/16, "4:3":4/3, "1:1":1, "21:9":21/9
    };
    const ratio = ratios[value];
    if (ratio >= 1) {
      const width = Math.max(projectSettingsWidth, projectSettingsHeight);
      setProjectSettingsWidth(width);
      setProjectSettingsHeight(Math.max(1, Math.round(width / ratio)));
    } else {
      const height = Math.max(projectSettingsWidth, projectSettingsHeight);
      setProjectSettingsHeight(height);
      setProjectSettingsWidth(Math.max(1, Math.round(height * ratio)));
    }
    setProjectSettingsResolution("custom");
  }

  function updateProjectResolution(value: string) {
    setProjectSettingsResolution(value);
    if (value === "custom") return;
    const [width, height] = value.split("x").map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    setProjectSettingsWidth(width);
    setProjectSettingsHeight(height);
    const ratio = width / height;
    const known: Array<["16:9" | "9:16" | "4:3" | "1:1" | "21:9", number]> = [
      ["16:9",16/9],["9:16",9/16],["4:3",4/3],["1:1",1],["21:9",21/9]
    ];
    setProjectSettingsAspect(known.find(([,target])=>Math.abs(ratio-target)<0.015)?.[0] ?? "custom");
  }

  function saveProjectSettings() {
    const width = Math.round(projectSettingsWidth);
    const height = Math.round(projectSettingsHeight);
    const frameRate = projectSettingsFrameRate;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 16384 || height > 16384) {
      setNotice("Canvas width and height must be between 1 and 16384 pixels.");
      return;
    }
    if (!Number.isFinite(frameRate) || frameRate < 1 || frameRate > 120) {
      setNotice("Frame rate must be between 1 and 120 FPS.");
      return;
    }
    change(p => ({ ...p, width, height, frameRate }));
    setProjectSettingsOpen(false);
    setNotice("Project canvas and frame rate settings saved.");
  }

  function startPreviewTransform(event: React.PointerEvent<HTMLDivElement>, target: { id: string; kind: PreviewTransformKind; x: number; y: number; width: number; height: number; tab?: VersionTimelineTab; key: string }) {
    event.preventDefault();
    event.stopPropagation();
    const frame = event.currentTarget.closest(".integrated-preview-frame") as HTMLElement | null;
    const rect = frame?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const handle = (event.target as HTMLElement).dataset.handle ?? "";
    const start: PreviewTransformStart = {
      ...target, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      frameWidth: rect.width, frameHeight: rect.height, mode: handle ? "resize" : "move", handle
    };
    previewTransformRef.current = start;
    setPreviewTransformDraft({ key: target.key, x: target.x, y: target.y, width: target.width, height: target.height });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in a test DOM. */ }
  }

  function movePreviewTransform(event: React.PointerEvent<HTMLDivElement>) {
    const active = previewTransformRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = (event.clientX - active.startX) / active.frameWidth * 100;
    const dy = (event.clientY - active.startY) / active.frameHeight * 100;
    const frame = active.mode === "move"
      ? moveNormalizedFrame(active, dx, dy)
      : resizeNormalizedFrame(active, active.handle, dx, dy);
    setPreviewTransformDraft({ key: active.key, ...frame });
  }

  function finishPreviewTransform(event: React.PointerEvent<HTMLDivElement>) {
    const active = previewTransformRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    previewTransformRef.current = null;
    const draft = previewTransformDraft;
    setPreviewTransformDraft(null);
    if (!draft || draft.key !== active.key) return;
    const patch = { x: draft.x, y: draft.y, width: draft.width, height: draft.height };
    if (active.kind === "layer" && active.tab) {
      updateTimelineVersionLayer(active.tab, active.id, patch);
    } else if (active.kind === "clip") {
      change(p => ({ ...p, timelineClips: (p.timelineClips ?? []).map(clip => clip.id === active.id ? { ...clip, ...patch } : clip) }));
    } else {
      change(p => ({ ...p, tracks: p.tracks.map(track => track.id === active.id ? { ...track, ...patch } : track) }));
    }
    setNotice("Preview frame transform saved.");
  }

  function undoProjectChange() {
    if (!undoStackRef.current.length) return;
    lastHistoryGroup.current = "";
    const history = undoHistory({ current: copy(projectRef.current), undo: undoStackRef.current, redo: redoStackRef.current });
    projectRef.current = { ...copy(history.current), updatedAt: new Date().toISOString() };
    undoStackRef.current = history.undo.map(copy);
    redoStackRef.current = history.redo.map(copy);
    setProject(projectRef.current);
    setUndoStack(undoStackRef.current);
    setRedoStack(redoStackRef.current);
    setNotice("Last project change undone.");
  }
  function redoProjectChange() {
    if (!redoStackRef.current.length) return;
    lastHistoryGroup.current = "";
    const history = redoHistory({ current: copy(projectRef.current), undo: undoStackRef.current, redo: redoStackRef.current });
    projectRef.current = { ...copy(history.current), updatedAt: new Date().toISOString() };
    undoStackRef.current = history.undo.map(copy);
    redoStackRef.current = history.redo.map(copy);
    setProject(projectRef.current);
    setUndoStack(undoStackRef.current);
    setRedoStack(redoStackRef.current);
    setNotice("Project change restored.");
  }
  function addShot() {
    const shotId = id("shot"), slotId = id("slot"), versionId = id("version");
    const shot: Shot = { id: shotId, title: String(project.shots.length + 1).padStart(2, "0") + " · " + t("shot.defaultTitle"), intent: "", duration: 5, status: "planned", referenceProfileIds: [], referenceOverrides: [], slots: [{ id: slotId, name: t("slot.defaultName"), start: 0, duration: 5, selectedVersionId: versionId, versions: [{ id: versionId, name: t("version.defaultName"), description: "", duration: 5, layers: [], scriptVersionIds: [], generationRecords: [] }] }] };
    change(p => ({ ...p, shots: [...p.shots, shot] })); setSelectedId(shotId); setNotice(t("notice.shotAdded"));
  }
  function removeShot(shotId: string) {
    if (project.shots.length <= 1) {
      setNotice("A project must keep at least one shot.");
      return;
    }
    const shot = project.shots.find(item => item.id === shotId);
    if (!shot || !window.confirm(`Delete shot "${shot.title}" and its clip slots? This can be undone.`)) return;
    const index = project.shots.findIndex(item => item.id === shotId);
    const nextShot = project.shots[index + 1] ?? project.shots[index - 1];
    change(p => ({ ...p, shots: p.shots.filter(item => item.id !== shotId) }));
    if (selectedId === shotId) {
      setSelectedId(nextShot?.id ?? "");
      setEditorTime(0);
    }
    setSelectedSlotId("");
    setNotice("Shot deleted. Use Undo to restore it.");
  }
  function duplicateShot(shotId: string) {
    const source = project.shots.find(item => item.id === shotId);
    if (!source) return;
    const versionIdMap = new Map<string, string>();
    const duplicate: Shot = {
      ...JSON.parse(JSON.stringify(source)) as Shot,
      id: id("shot"),
      title: source.title + " copy",
      slots: source.slots.map(slot => {
        const newSlotId = id("slot");
        const versions = slot.versions.map(version => {
          const newVersionId = id("version");
          versionIdMap.set(version.id, newVersionId);
          return {
            ...version,
            id: newVersionId,
            layers: version.layers.map(layer => ({ ...layer, id: id("layer") })),
            generationRecords: version.generationRecords.map(record => ({ ...record, id: id("generation") })),
          };
        });
        return {
          ...slot,
          id: newSlotId,
          selectedVersionId: versionIdMap.get(slot.selectedVersionId) ?? versions[0]?.id ?? "",
          versions,
        };
      }),
    };
    change(p => {
      const index = p.shots.findIndex(item => item.id === shotId);
      if (index < 0) return p;
      const shots = [...p.shots];
      shots.splice(index + 1, 0, duplicate);
      return { ...p, shots };
    });
    setSelectedId(duplicate.id);
    setSelectedSlotId(duplicate.slots[0]?.id ?? "");
    const sourceStart = project.shots.slice(0, Math.max(0, project.shots.findIndex(item => item.id === shotId))).reduce((sum, item) => sum + item.duration, 0);
    setEditorTime(Math.min(runtime, sourceStart + source.duration));
    setNotice("Shot duplicated and focused. Use Undo to reverse.");
  }

  function addSlot(shotId: string) {
    const slotId = id("slot"), versionId = id("version");
    change(p => ({ ...p, shots: p.shots.map(s => s.id !== shotId ? s : { ...s, slots: [...s.slots, { id: slotId, name: t("slot.defaultPrefix") + (s.slots.length + 1), start: s.slots.reduce((n, c) => Math.max(n, c.start + c.duration), 0), duration: 3, selectedVersionId: versionId, versions: [{ id: versionId, name: t("version.defaultName"), description: "", duration: 3, layers: [], scriptVersionIds: [], generationRecords: [] }] }] }) }));
    setNotice(t("notice.clipSlotAdded"));
  }
  function removeSlot(shotId: string, slotId: string) {
    const shot = project.shots.find(item => item.id === shotId);
    if (!shot) return;
    if (shot.slots.length <= 1) {
      setNotice("A shot must keep at least one clip slot.");
      return;
    }
    const slot = shot.slots.find(item => item.id === slotId);
    if (!slot || !window.confirm(`Delete clip slot "${slot.name}" and its versions? This can be undone.`)) return;
    change(p => ({ ...p, shots: p.shots.map(item => item.id !== shotId ? item : { ...item, slots: item.slots.filter(candidate => candidate.id !== slotId) }) }));
    if (selectedSlotId === slotId) setSelectedSlotId("");
    setNotice("Clip slot deleted. Use Undo to restore it.");
  }
  function duplicateSlot(shotId: string, slotId: string) {
    const shot = project.shots.find(item => item.id === shotId);
    const source = shot?.slots.find(item => item.id === slotId);
    if (!shot || !source) return;
    const versionIdMap = new Map<string, string>();
    const versions = source.versions.map(version => {
      const newVersionId = id("version");
      versionIdMap.set(version.id, newVersionId);
      return {
        ...JSON.parse(JSON.stringify(version)),
        id: newVersionId,
        layers: version.layers.map(layer => ({ ...layer, id: id("layer") })),
        generationRecords: version.generationRecords.map(record => ({ ...record, id: id("generation") })),
      };
    });
    const duplicate = {
      ...JSON.parse(JSON.stringify(source)),
      id: id("slot"),
      name: source.name + " copy",
      start: source.start + source.duration,
      selectedVersionId: versionIdMap.get(source.selectedVersionId) ?? versions[0]?.id ?? "",
      versions,
    };
    const shotStart = project.shots.slice(0, Math.max(0, project.shots.findIndex(item => item.id === shotId))).reduce((sum, item) => sum + item.duration, 0);
    change(p => ({ ...p, shots: p.shots.map(item => {
      if (item.id !== shotId) return item;
      const sourceIndex = item.slots.findIndex(slot => slot.id === slotId);
      const slots = [...item.slots];
      slots.splice(sourceIndex + 1, 0, duplicate);
      return { ...item, slots };
    }) }));
    setSelectedId(shotId);
    setSelectedSlotId(duplicate.id);
    setEditorTime(Math.min(runtime, shotStart + duplicate.start));
    setNotice("Clip slot duplicated and focused. Use Undo to reverse.");
  }

  function updateShot(shotId: string, patch: Partial<Shot>) {
    const textField = "title" in patch ? "shot-title:" + shotId : "intent" in patch ? "shot-intent:" + shotId : "";
    change(p => {
      const shots = typeof patch.duration === "number" ? setMasterShotDuration(p.shots, shotId, patch.duration) : p.shots;
      return { ...p, shots: shots.map(s => s.id === shotId ? { ...s, ...patch } : s) };
    }, textField);
  }
  function updateMasterShotStart(shotId: string, value: number) {
    if (!Number.isFinite(value)) return;
    change(p => ({ ...p, shots: setMasterShotStart(p.shots, shotId, value) }), "shot-start:" + shotId);
  }
  function selectClipSlot(slotId: string) { setSelectedSlotId(slotId); }
  function syncStoryboardToTimeline() {
    const videoTrack = project.tracks.find(track => track.kind === "video");
    const audioTrack = project.tracks.find(track => track.kind === "audio");
    if (!videoTrack || !audioTrack) { setNotice("Timeline needs both video and audio tracks before syncing."); return; }
    const shotStarts = getMasterShotStarts(project.shots);
    const generated = project.shots.flatMap((shot, shotIndex) => {
      const shotOffset = shotStarts[shotIndex];
      const clips = shot.slots.flatMap(slot => {
        const version = slot.versions.find(item => item.id === slot.selectedVersionId) ?? slot.versions[0];
        const layers = version?.layers.filter(layer => layer.kind === "video" || layer.kind === "image" || layer.kind === "audio") ?? [];
        const sourceLayers = layers.length ? layers : [{ id: "base", name: slot.name, kind: "video" as const, start: 0, duration: slot.duration }];
        return sourceLayers.map(layer => {
          const kind = layer.kind === "audio" ? "audio" as const : "video" as const;
          const track = kind === "audio" ? audioTrack : videoTrack;
          const assetId = layer.assetId && project.assets.some(asset => asset.id === layer.assetId) ? layer.assetId : undefined;
          const clipId = "storyboard-" + shot.id + "-" + slot.id + "-" + layer.id;
          const duration = Math.max(0.1, Math.min(layer.duration, Math.max(0.1, shot.duration - slot.start - layer.start)));
          return { id: clipId, name: layer.name || slot.name, kind, trackId: track.id, start: shotOffset + slot.start + layer.start, duration, ...(kind === "video" ? { shotId: shot.id, slotId: slot.id } : {}), ...(assetId ? { assetId } : {}), ...(layer.sourceIn !== undefined ? { sourceIn: layer.sourceIn } : {}), ...(layer.sourceOut !== undefined ? { sourceOut: layer.sourceOut } : {}), ...(layer.prompt ? { prompt: layer.prompt } : {}), ...(layer.modelName ? { modelName: layer.modelName } : {}), ...(layer.modelVersion ? { modelVersion: layer.modelVersion } : {}), ...(layer.muted ? { muted: layer.muted } : {}) };
        });
      });
      return clips;
    });
    change(p => ({ ...p, timelineClips: [...(p.timelineClips ?? []).filter(clip => !clip.id.startsWith("storyboard-")), ...generated] }));
    setNotice("Storyboard synced to media timeline. Manually created clips were preserved.");
    setView("timeline");
  }

  function saveMasterTimelineAsClipAsset() {
    const current = projectRef.current;
    const flattenedLayers = collectCompositionLayers(current).map(layer => ({ ...layer, id: id("layer") }));
    const duration = Math.max(
      0.1,
      getMasterTimelineDuration(current.shots),
      ...flattenedLayers.map(layer => layer.start + layer.duration)
    );
    const now = new Date().toISOString();
    const version: ClipVersion = {
      id: id("clip-version"),
      name: "Version A",
      description: "Snapshot saved from Master Timeline",
      duration,
      layers: flattenedLayers,
      scriptVersionIds: [],
      generationRecords: []
    };
    const asset: Asset = {
      id: id("asset"),
      name: current.name + " · Timeline Clip",
      kind: "clip",
      canvasWidth: current.width,
      canvasHeight: current.height,
      notes: "Snapshot saved from the Master Timeline. Edits to this Clip Asset are independent.",
      createdAt: now,
      updatedAt: now,
      selectedClipVersionId: version.id,
      clipVersions: [version]
    };
    change(p => ({ ...p, assets: [...p.assets, asset] }));
    setNotice("Master Timeline saved as a reusable Clip Asset. The original Master Timeline is unchanged.");
  }

  function addStoryboardConnection(fromShotId: string, toShotId: string, label = "Cut") {
    change(p => {
      const existing = p.storyboardConnections ?? [];
      if (existing.some(c => c.fromShotId === fromShotId && c.toShotId === toShotId)) return p;
      return {
        ...p,
        storyboardConnections: [...existing, { fromShotId, toShotId, label }]
      };
    });
    setNotice("Connected shots in storyboard flow.");
  }

  function removeStoryboardConnection(fromShotId: string, toShotId: string) {
    change(p => ({
      ...p,
      storyboardConnections: (p.storyboardConnections ?? []).filter(c => !(c.fromShotId === fromShotId && c.toShotId === toShotId))
    }));
    setNotice("Removed transition link.");
  }

  function attachAssetToShot(shotId: string, file: File) {
    const mime = file.type.toLowerCase();
    const kind: AssetKind = mime.startsWith("video/") ? "video" : "image";
    if (assetUploadKind !== "all" && kind !== assetUploadKind) {
      setNotice(assetUploadKind === "audio" ? "Choose an audio file to create an Audio Asset." : "Choose an image file to create an Image Asset.");
      return;
    }
    if (kind === "image") {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          const assetId = id("asset");
          const asset: Asset = { id: assetId, name: file.name, kind: "image", path: reader.result, notes: "Attached to shot" };
          change(p => ({
            ...p,
            assets: [...p.assets, asset],
            shots: p.shots.map(s => s.id === shotId ? {
              ...s,
              previewAssetId: assetId,
              status: "ready" as const,
              slots: s.slots.map(slot => ({
                ...slot,
                versions: slot.versions.map(v => ({
                  ...v,
                  layers: v.layers.length
                    ? v.layers.map((l, li) => li === 0 ? { ...l, assetId, kind: "image" as const } : l)
                    : [{ id: id("layer"), name: "Attached visual", kind: "image" as const, start: 0, duration: v.duration, assetId }]
                }))
              }))
            } : s)
          }));
          setNotice("Attached image to shot.");
        }
      };
      reader.readAsDataURL(file);
    } else {
      const assetId = id("asset");
      void Promise.all([storeMediaAsset(assetId, file), createVideoThumbnail(file)]).then(([path, thumbnailPath]) => {
        const asset: Asset = { id: assetId, name: file.name, kind: "video", path, notes: "Attached to shot", ...(thumbnailPath ? { thumbnailPath } : {}) };
        change(p => ({
          ...p,
          assets: [...p.assets, asset],
          shots: p.shots.map(s => s.id === shotId ? {
            ...s,
            previewAssetId: assetId,
            status: "ready" as const,
            slots: s.slots.map(slot => ({
              ...slot,
              versions: slot.versions.map(v => ({
                ...v,
                layers: v.layers.length
                  ? v.layers.map((l, li) => li === 0 ? { ...l, assetId, kind: "video" as const } : l)
                  : [{ id: id("layer"), name: "Attached video", kind: "video" as const, start: 0, duration: v.duration, assetId }]
              }))
            }))
          } : s)
        }));
        setNotice("Attached video to shot.");
      });
    }
  }

  function recordVersionGeneration(shotId: string, slotId: string, versionId: string) {
    const shot = project.shots.find(item => item.id === shotId);
    const slot = shot?.slots.find(item => item.id === slotId);
    const version = slot?.versions.find(item => item.id === versionId);
    if (!shot || !slot || !version) return;
    const references = project.referenceProfiles
      .filter(profile => shot.referenceProfileIds.includes(profile.id))
      .flatMap(profile => profile.references)
      .filter(reference => !shot.referenceOverrides.some(override => override.referenceId === reference.id && override.action === "exclude"))
      .map(reference => {
        const override = shot.referenceOverrides.find(item => item.referenceId === reference.id && item.action === "replace");
        return override?.replacementAssetId ? { ...reference, assetId: override.replacementAssetId } : { ...reference };
      });
    const prompt = version.layers.map(layer => layer.prompt).filter(Boolean).join("\
") || version.description || shot.intent;
    change(p => ({ ...p, shots: p.shots.map(item => item.id !== shotId ? item : { ...item, slots: item.slots.map(candidate => candidate.id !== slotId ? candidate : { ...candidate, versions: candidate.versions.map(v => v.id !== versionId ? v : { ...v, generationRecords: [...v.generationRecords, { id: id("generation"), createdAt: new Date().toISOString(), prompt, referenceSnapshot: references, modelName: version.layers.find(layer => layer.modelName)?.modelName, modelVersion: version.layers.find(layer => layer.modelVersion)?.modelVersion }] }) }) }) }));
    setNotice("Generation provenance snapshot recorded. No AI provider was called.");
  }
  function getGenerationReferencePaths(shotId: string): string[] {
    const current = projectRef.current;
    const shot = current.shots.find(item => item.id === shotId);
    if (!shot) return [];
    return current.referenceProfiles
      .filter(profile => shot.referenceProfileIds.includes(profile.id))
      .flatMap(profile => profile.references)
      .filter(reference => !shot.referenceOverrides.some(override => override.referenceId === reference.id && override.action === "exclude"))
      .map(reference => {
        const override = shot.referenceOverrides.find(item => item.referenceId === reference.id && item.action === "replace");
        const asset = current.assets.find(item => item.id === (override?.replacementAssetId ?? reference.assetId) && item.kind === "image");
        return asset?.path;
      })
      .filter((path): path is string => Boolean(path));
  }
  function updateCompositionLayer(shotId: string, slotId: string, versionId: string, layerId: string, patch: Partial<CompositionLayer>) {
    change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== shotId ? shot : {
      ...shot,
      slots: shot.slots.map(slot => slot.id !== slotId ? slot : {
        ...slot,
        versions: slot.versions.map(version => version.id !== versionId ? version : {
          ...version,
          layers: version.layers.map(layer => {
            if (layer.id !== layerId) return layer;
            const updated = { ...layer, ...patch };
            return typeof patch.duration === "number" ? withDurationAndClampedFades(updated, patch.duration) : updated;
          })
        })
      })
    }) }));
  }

  function updateTimelineVersion(tab: VersionTimelineTab, update: (version: ClipVersion) => ClipVersion) {
    if (tab.assetId) {
      change(p => ({
        ...p,
        assets: p.assets.map(asset => asset.id !== tab.assetId || asset.kind !== "clip" ? asset : {
          ...asset,
          updatedAt: new Date().toISOString(),
          clipVersions: (asset.clipVersions ?? []).map(version => version.id === tab.versionId ? update(version) : version)
        })
      }));
      return;
    }
    change(p => ({
      ...p,
      shots: p.shots.map(shot => shot.id !== tab.shotId ? shot : {
        ...shot,
        slots: shot.slots.map(slot => slot.id !== tab.slotId ? slot : {
          ...slot,
          versions: slot.versions.map(version => version.id === tab.versionId ? update(version) : version)
        })
      })
    }));
  }

  function updateTimelineVersionLayer(tab: VersionTimelineTab, layerId: string, patch: Partial<CompositionLayer>) {
    const current = projectRef.current;
    const version = tab.assetId
      ? current.assets.find(asset => asset.id === tab.assetId && asset.kind === "clip")?.clipVersions?.find(item => item.id === tab.versionId)
      : current.shots.find(shot => shot.id === tab.shotId)?.slots.find(slot => slot.id === tab.slotId)?.versions.find(item => item.id === tab.versionId);
    const layer = version?.layers.find(item => item.id === layerId);
    if (!layer) return;

    const requestedAssetId = patch.assetId;
    const requestedAsset = requestedAssetId ? current.assets.find(asset => asset.id === requestedAssetId) : undefined;
    if (tab.assetId && requestedAsset?.kind === "clip" && wouldCreateClipAssetCycle(current.assets, tab.assetId, requestedAsset.id)) {
      setNotice("That Clip cannot be added because it would create a circular Clip reference.");
      return;
    }

    let safePatch = { ...patch };
    if (patch.kind !== undefined && patch.kind !== "composition") {
      safePatch = { ...safePatch, childCompositionId: undefined, clipVersionId: undefined };
    }
    if (requestedAsset?.kind === "clip" && (patch.kind === "composition" || layer.kind === "composition")) {
      safePatch = {
        ...safePatch,
        kind: "composition",
        childCompositionId: requestedAsset.id,
        clipVersionId: requestedAsset.selectedClipVersionId ?? requestedAsset.clipVersions?.[0]?.id,
      };
    }
    updateTimelineVersion(tab, currentVersion => ({
      ...currentVersion,
      layers: currentVersion.layers.map(item => {
        if (item.id !== layerId) return item;
        const updated = { ...item, ...safePatch };
        return typeof safePatch.duration === "number" ? withDurationAndClampedFades(updated, safePatch.duration) : updated;
      })
    }));
  }

  function addTimelineVersionLayer(tab: VersionTimelineTab, kind: CompositionLayer["kind"]) {
    const current = projectRef.current;
    const version = tab.assetId
      ? current.assets.find(asset => asset.id === tab.assetId && asset.kind === "clip")?.clipVersions?.find(item => item.id === tab.versionId)
      : current.shots.find(shot => shot.id === tab.shotId)?.slots.find(slot => slot.id === tab.slotId)?.versions.find(item => item.id === tab.versionId);
    if (!version) return;
    const start = Math.max(0, Math.min(editorTime, Math.max(0, version.duration - 0.1)));
    const name = kind === "procedural" ? "Code clip" : kind === "text" ? "Text layer" : kind === "audio" ? "Audio layer" : kind === "image" ? "Image layer" : kind === "composition" ? "Nested Clip" : "Video layer";
    const layer: CompositionLayer = { id: id("layer"), name, kind, start, duration: Math.max(0.1, Math.min(3, version.duration - start)) };
    updateTimelineVersion(tab, currentVersion => ({ ...currentVersion, layers: [...currentVersion.layers, layer] }));
    setSelectedCompositionLayerId(layer.id);
    setNotice(kind === "composition" ? "Empty nested Clip module added. Choose a Clip Asset in its Source asset setting." : "Layer added to the selected timeline.");
  }

  function removeTimelineVersionLayer(tab: VersionTimelineTab, layerId: string) {
    updateTimelineVersion(tab, version => ({ ...version, layers: version.layers.filter(layer => layer.id !== layerId) }));
    setSelectedCompositionLayerId(current => current === layerId ? "" : current);
  }

  function moveTimelineVersionLayer(tab: VersionTimelineTab, layerId: string, direction: -1 | 1) {
    updateTimelineVersion(tab, version => {
      const index = version.layers.findIndex(layer => layer.id === layerId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= version.layers.length) return version;
      const layers = [...version.layers];
      [layers[index], layers[target]] = [layers[target], layers[index]];
      return { ...version, layers };
    });
  }

  function updateTimelineVersionDuration(tab: VersionTimelineTab, value: number) {
    if (!Number.isFinite(value) || value < 0.1) return;
    const duration = Math.max(0.1, value);
    updateTimelineVersion(tab, version => ({ ...version, duration }));
    if (editorTime > duration) {
      playbackTimeRef.current = duration;
      setEditorTime(duration);
      setIsPlaying(false);
    }
    setNotice("Timeline duration updated; parent Shot or Master Timeline timing remains unchanged.");
  }

  function updateTimelineVersionDescription(tab: VersionTimelineTab, description: string) {
    updateTimelineVersion(tab, version => ({ ...version, description }));
  }

  function updateVersionDuration(shotId: string, slotId: string, versionId: string, value: number) {
    if (!Number.isFinite(value) || value < 0.1) return;
    const duration = Math.max(0.1, value);
    change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== shotId ? shot : {
      ...shot,
      slots: shot.slots.map(slot => slot.id !== slotId ? slot : {
        ...slot,
        versions: slot.versions.map(version => version.id === versionId ? { ...version, duration } : version)
      })
    }) }), "version-duration:" + versionId);
    if (editorTime > duration) {
      playbackTimeRef.current = duration;
      setEditorTime(duration);
      setIsPlaying(false);
    }
    setNotice("Version-internal duration updated; Master Shot and Clip Slot timing remain unchanged.");
  }
  function duplicateClipAssetVersion(assetId: string, versionId: string) {
    const asset = projectRef.current.assets.find(item => item.id === assetId && item.kind === "clip");
    const current = asset?.kind === "clip" ? asset.clipVersions?.find(item => item.id === versionId) : undefined;
    if (!asset || asset.kind !== "clip" || !current) return;
    const nextId = id("clip-version");
    const nextVersion: ClipVersion = {
      ...(JSON.parse(JSON.stringify(current)) as ClipVersion),
      id: nextId,
      name: "Version " + ((asset.clipVersions?.length ?? 0) + 1),
      description: current.description ? "Copy of " + current.name + ": " + current.description : "New version based on " + current.name,
      layers: current.layers.map(layer => ({ ...layer, id: id("layer") })),
      scriptVersionIds: [...current.scriptVersionIds],
      generationRecords: []
    };
    change(p => ({
      ...p,
      assets: p.assets.map(item => item.id !== assetId || item.kind !== "clip" ? item : {
        ...item,
        updatedAt: new Date().toISOString(),
        selectedClipVersionId: nextId,
        clipVersions: [...(item.clipVersions ?? []), nextVersion]
      })
    }));
    const tabId = "clip-asset:" + assetId + ":" + nextId;
    setTimelineTabs(existing => existing.some(tab => tab.id === tabId) ? existing : [
      ...existing, { id: tabId, shotId: "", slotId: "", assetId, versionId: nextId, label: asset.name + " · " + nextVersion.name }
    ]);
    setTimelineTabTimes(times => ({ ...times, [activeTimelineTabId]: editorTime, [tabId]: 0 }));
    setActiveTimelineTabId(tabId);
    setSelectedId("");
    setSelectedSlotId("");
    setSelectedTimelineClipId("");
    setSelectedCompositionLayerId("");
    setEditorTime(0);
    playbackTimeRef.current = 0;
    setIsPlaying(false);
    setView("timeline");
    setNotice("Duplicated Clip Version. Previous versions remain unchanged.");
  }

  function updateSlotName(shotId: string, slotId: string, name: string) {
    change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== shotId ? shot : {
      ...shot,
      slots: shot.slots.map(slot => slot.id === slotId ? { ...slot, name } : slot),
    }) }), "slot-name:" + slotId);
  }
  function updateSlotTiming(shotId: string, slotId: string, field: "start" | "duration", value: number) {
    if (!Number.isFinite(value)) return;
    const safeValue = field === "start" ? Math.max(0, value) : Math.max(0.1, value);
    change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== shotId ? shot : {
      ...shot,
      slots: shot.slots.map(slot => {
        if (slot.id !== slotId) return slot;
        if (field === "start") return { ...slot, start: safeValue };
        return { ...slot, duration: safeValue };
      })
    }) }));
    setNotice(field === "start" ? "Clip slot start time updated." : "Clip Slot duration updated; Version-internal durations remain unchanged.");
  }
  function renderVersionThumbnail(version: ClipVersion, fallbackColor = "#111113") {
    const videoLayer = version.layers.find(layer => layer.kind === "video" || layer.kind === "image");
    const codeLayer = version.layers.find(layer => layer.kind === "procedural" || layer.kind === "script");
    const videoAsset = videoLayer?.assetId ? project.assets.find(asset => asset.id === videoLayer.assetId) : undefined;
    const videoThumb = videoLayer?.thumbnailPath ?? getAssetThumbnail(videoAsset);
    const codeBackground = codeLayer?.backgroundColor ?? version.layers.find(layer => layer.backgroundColor)?.backgroundColor ?? fallbackColor;
    return <div className={"version-thumbnail-preview" + (videoLayer && codeLayer ? " has-video-and-code" : "")} aria-label={videoLayer && codeLayer ? "Video and code thumbnail" : codeLayer ? "Code thumbnail" : videoLayer ? "Video thumbnail" : "Placeholder thumbnail"} style={{ backgroundColor: codeLayer || !videoLayer ? codeBackground : fallbackColor }}>
      {videoLayer && <div className="version-thumbnail-video">{videoThumb ? <img src={videoThumb} alt="" /> : <Film size={15}/>}</div>}
      {codeLayer && <div className="version-thumbnail-code" style={{ backgroundColor: codeBackground }}><Code2 size={17}/></div>}
      {!videoLayer && !codeLayer && <span className="version-thumbnail-placeholder" style={{ backgroundColor: fallbackColor }} />}
      {videoLayer && codeLayer && <span className="version-thumbnail-divider"><span>↔</span></span>}
    </div>;
  }
  function chooseSlotVersion(shotId: string, slotId: string, versionId: string) {
    change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== shotId ? shot : { ...shot, slots: shot.slots.map(slot => slot.id !== slotId ? slot : { ...slot, selectedVersionId: versionId }) }) }));
    setNotice("Timeline clip version selected.");
  }
  function createSlotVersion(shotId: string, slotId: string): string | undefined {
    const shot = project.shots.find(item => item.id === shotId);
    const slot = shot?.slots.find(item => item.id === slotId);
    if (!shot || !slot) return;
    const current = slot.versions.find(version => version.id === slot.selectedVersionId) ?? slot.versions[0];
    const nextId = id("version");
    const nextVersion = current ? { ...JSON.parse(JSON.stringify(current)), id: nextId, name: "Version " + (slot.versions.length + 1), description: current.description ? "Copy of " + current.name + ": " + current.description : "New version based on " + current.name, layers: current.layers.map(layer => ({ ...layer, id: id("layer") })), scriptVersionIds: [...current.scriptVersionIds], generationRecords: [] } : { id: nextId, name: "Version 1", description: "", duration: slot.duration, layers: [], scriptVersionIds: [], generationRecords: [] };
    change(p => ({ ...p, shots: p.shots.map(item => item.id !== shotId ? item : { ...item, slots: item.slots.map(s => s.id !== slotId ? s : { ...s, versions: [...s.versions, nextVersion], selectedVersionId: nextId }) }) }));
    setNotice("New version created; the previous versions are preserved.");
    return nextId;
  }

  function openVersionTimeline(shotId: string, slotId: string, versionId: string) {
    const shot = project.shots.find(item => item.id === shotId);
    const slot = shot?.slots.find(item => item.id === slotId);
    const version = slot?.versions.find(item => item.id === versionId);
    if (!shot || !slot || !version) return;
    const tabId = "version:" + slotId + ":" + versionId;
    setTimelineTabs(existing => existing.some(tab => tab.id === tabId) ? existing : [...existing, { id: tabId, shotId, slotId, versionId, label: slot.name + " · " + version.name }]);
    setTimelineTabTimes(times => ({ ...times, [activeTimelineTabId]: editorTime, [tabId]: times[tabId] ?? 0 }));
    setActiveTimelineTabId(tabId);
    setSelectedId(shotId);
    setSelectedSlotId(slotId);
    const nextTime = Math.min(timelineTabTimes[tabId] ?? 0, version.duration);
    setEditorTime(nextTime);
    playbackTimeRef.current = nextTime;
    setSelectedTimelineClipId("");
    setIsPlaying(false);
    setView("timeline");
  }

  function chooseClipAssetVersion(assetId: string, versionId: string) {
    change(p => ({
      ...p,
      assets: p.assets.map(asset => asset.id === assetId && asset.kind === "clip"
        ? { ...asset, selectedClipVersionId: versionId, updatedAt: new Date().toISOString() }
        : asset)
    }));
    openClipAssetTimeline(assetId, versionId);
    setNotice("Selected Clip Version for new references. Existing references remain pinned.");
  }

  function openClipAssetTimeline(assetId: string, versionId: string) {
    const asset = projectRef.current.assets.find(item => item.id === assetId && item.kind === "clip");
    const version = asset?.kind === "clip" ? asset.clipVersions?.find(item => item.id === versionId) : undefined;
    if (!asset || asset.kind !== "clip" || !version) return;
    const tabId = "clip-asset:" + assetId + ":" + versionId;
    setTimelineTabs(existing => existing.some(tab => tab.id === tabId) ? existing : [
      ...existing,
      { id: tabId, shotId: "", slotId: "", assetId, versionId, label: asset.name + " · " + version.name }
    ]);
    setTimelineTabTimes(times => ({ ...times, [activeTimelineTabId]: editorTime, [tabId]: times[tabId] ?? 0 }));
    setActiveTimelineTabId(tabId);
    setSelectedId("");
    setSelectedSlotId("");
    setSelectedTimelineClipId("");
    setSelectedCompositionLayerId("");
    const nextTime = Math.min(timelineTabTimes[tabId] ?? 0, version.duration);
    setEditorTime(nextTime);
    playbackTimeRef.current = nextTime;
    setIsPlaying(false);
    setView("timeline");
    setNotice("Opened Clip Asset timeline: " + asset.name + " · " + version.name);
  }

  function activateTimelineTab(tabId: string) {
    setTimelineTabTimes(times => ({ ...times, [activeTimelineTabId]: editorTime }));
    const nextTab = timelineTabs.find(tab => tab.id === tabId);
    const nextVersion = nextTab?.assetId
      ? project.assets.find(asset => asset.id === nextTab.assetId && asset.kind === "clip")?.clipVersions?.find(version => version.id === nextTab.versionId)
      : nextTab
        ? project.shots.find(shot => shot.id === nextTab.shotId)?.slots.find(slot => slot.id === nextTab.slotId)?.versions.find(version => version.id === nextTab.versionId)
        : undefined;
    const duration = tabId === "master" ? runtime : nextVersion?.duration ?? runtime;
    const nextTime = Math.min(timelineTabTimes[tabId] ?? 0, duration);
    setActiveTimelineTabId(tabId);
    if (tabId !== "master" && nextTab?.assetId) {
      setSelectedId("");
      setSelectedSlotId("");
      setSelectedTimelineClipId("");
      setSelectedCompositionLayerId("");
    } else if (nextTab) {
      setSelectedId(nextTab.shotId);
      setSelectedSlotId(nextTab.slotId);
    }
    setEditorTime(nextTime);
    playbackTimeRef.current = nextTime;
    setIsPlaying(false);
  }

  function closeTimelineTab(tabId: string) {
    setTimelineTabs(existing => existing.filter(tab => tab.id !== tabId));
    if (activeTimelineTabId === tabId) {
      activateTimelineTab("master");
    } else {
      setTimelineTabTimes(times => {
        const next = { ...times };
        delete next[tabId];
        return next;
      });
    }
  }

  function addVersionLayer(shotId: string, slotId: string, versionId: string, kind: CompositionLayer["kind"]) {
    const shot = project.shots.find(item => item.id === shotId);
    const slot = shot?.slots.find(item => item.id === slotId);
    const version = slot?.versions.find(item => item.id === versionId);
    if (!shot || !slot || !version) return;
    const start = Math.max(0, Math.min(editorTime, Math.max(0, version.duration - 0.1)));
    const layer: CompositionLayer = {
      id: id("layer"),
      name: kind === "procedural" ? "Code clip" : kind === "text" ? "Text layer" : kind === "audio" ? "Audio layer" : kind === "image" ? "Image layer" : kind === "composition" ? "Nested composition" : "Video layer",
      kind,
      start,
      duration: Math.max(0.1, Math.min(3, version.duration - start))
    };
    change(p => ({ ...p, shots: p.shots.map(item => item.id !== shotId ? item : { ...item, slots: item.slots.map(s => s.id !== slotId ? s : { ...s, versions: s.versions.map(v => v.id !== versionId ? v : { ...v, layers: [...v.layers, layer] }) }) }) }));
    setNotice(kind === "procedural" ? "Code clip added. Edit its JavaScript source in Settings." : "Layer added to the selected Version.");
  }

  function removeVersionLayer(shotId: string, slotId: string, versionId: string, layerId: string) {
    change(p => ({ ...p, shots: p.shots.map(item => item.id !== shotId ? item : { ...item, slots: item.slots.map(s => s.id !== slotId ? s : { ...s, versions: s.versions.map(v => v.id !== versionId ? v : { ...v, layers: v.layers.filter(layer => layer.id !== layerId) }) }) }) }));
  }

  function moveVersionLayer(shotId: string, slotId: string, versionId: string, layerId: string, direction: -1 | 1) {
    change(p => ({
      ...p,
      shots: p.shots.map(shot => shot.id !== shotId ? shot : {
        ...shot,
        slots: shot.slots.map(slot => slot.id !== slotId ? slot : {
          ...slot,
          versions: slot.versions.map(version => {
            if (version.id !== versionId) return version;
            const index = version.layers.findIndex(layer => layer.id === layerId);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= version.layers.length) return version;
            const layers = [...version.layers];
            [layers[index], layers[target]] = [layers[target], layers[index]];
            return { ...version, layers };
          })
        })
      })
    }));
  }

  function beginMasterShotResize(event: React.PointerEvent<HTMLElement>, shot: Shot, start: number, edge: "left" | "right") {
    event.preventDefault();
    event.stopPropagation();
    const lane = event.currentTarget.closest(".visual-track-lane") as HTMLElement | null;
    shotResizeRef.current = { id: shot.id, edge, pointerId: event.pointerId, x: event.clientX, start, duration: shot.duration, laneWidth: lane?.getBoundingClientRect().width ?? 1 };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveMasterShotResize(event: React.PointerEvent<HTMLElement>, shot: Shot) {
    const active = shotResizeRef.current;
    if (!active || active.id !== shot.id || active.pointerId !== event.pointerId) return;
    const fps = Math.max(1, project.frameRate || 24), frame = 1 / fps;
    const delta = Math.round(((event.clientX - active.x) / Math.max(active.laneWidth, 1)) * mediaTimelineDuration * fps) / fps;
    const others = project.shots.filter(item => item.id !== shot.id).map(item => ({ start: getMasterShotStart(project.shots, item.id), duration: item.duration })).sort((a,b)=>a.start-b.start);
    if (active.edge === "left") {
      const previous = others.filter(item => item.start + item.duration <= active.start + 0.0001).at(-1);
      const end = active.start + active.duration;
      const start = Math.max(previous ? previous.start + previous.duration : 0, Math.min(end - frame, active.start + delta));
      setShotResizePreview({ id: shot.id, start, duration: end - start });
    } else {
      const next = others.find(item => item.start >= active.start + active.duration - 0.0001);
      const maxDuration = next ? next.start - active.start : mediaTimelineDuration - active.start;
      setShotResizePreview({ id: shot.id, start: active.start, duration: Math.max(frame, Math.min(maxDuration, active.duration + delta)) });
    }
  }
  function endMasterShotResize(event: React.PointerEvent<HTMLElement>, shot: Shot) {
    const active = shotResizeRef.current;
    if (!active || active.id !== shot.id || active.pointerId !== event.pointerId) return;
    const preview = shotResizePreview;
    if (preview && preview.id === shot.id) change(p => ({ ...p, shots: p.shots.map(item => item.id === shot.id ? { ...item, masterStart: preview.start, duration: preview.duration } : item) }));
    shotResizeRef.current = null;
    setShotResizePreview(null);
  }

  function toggleShotReferenceProfile(shotId: string, profileId: string, checked: boolean) {
    const shot = project.shots.find(item => item.id === shotId);
    if (!shot) return;
    const profileIds = checked
      ? [...shot.referenceProfileIds, profileId]
      : shot.referenceProfileIds.filter(id => id !== profileId);
    const validReferenceIds = new Set(project.referenceProfiles
      .filter(profile => profileIds.includes(profile.id))
      .flatMap(profile => profile.references.map(reference => reference.id)));
    updateShot(shotId, {
      referenceProfileIds: profileIds,
      referenceOverrides: shot.referenceOverrides.filter(override => validReferenceIds.has(override.referenceId)),
    });
  }
  function updateShotReferenceOverride(shotId: string, referenceId: string, action: "inherit" | "exclude" | "replace", replacementAssetId?: string) {
    const shot = project.shots.find(item => item.id === shotId);
    if (!shot) return;
    const existing = shot.referenceOverrides.find(override => override.referenceId === referenceId);
    if (action === "inherit") {
      updateShot(shotId, { referenceOverrides: shot.referenceOverrides.filter(override => override.referenceId !== referenceId) });
      setNotice(t("notice.referenceOverrideReset"));
      return;
    }
    let replacement = replacementAssetId;
    if (action === "replace") {
      const originalAssetId = project.referenceProfiles.flatMap(profile => profile.references).find(reference => reference.id === referenceId)?.assetId;
      replacement = replacement ?? existing?.replacementAssetId ?? project.assets.find(asset => asset.id !== originalAssetId)?.id;
      if (!replacement) { setNotice(t("notice.referenceReplacementNeedsAsset")); return; }
    }
    const next = { referenceId, action, ...(action === "replace" && replacement ? { replacementAssetId: replacement } : {}), ...(existing?.role ? { role: existing.role } : {}) } as Shot["referenceOverrides"][number];
    updateShot(shotId, { referenceOverrides: [...shot.referenceOverrides.filter(override => override.referenceId !== referenceId), next] });
    setNotice(action === "exclude" ? t("notice.referenceExcluded") : t("notice.referenceReplaced"));
  }
  function addAsset(name: string, kind: AssetKind, notes = "", path?: string, thumbnailPath?: string) {
    const cleanName = name.trim();
    if (!cleanName) { setNotice(t("error.assetNameRequired")); return; }
    const now = new Date().toISOString();
    const asset: Asset = { id: id("asset"), name: cleanName, kind, notes: notes.trim(), createdAt: now, updatedAt: now, ...(path ? { path } : {}), ...(thumbnailPath ? { thumbnailPath } : {}) };
    change(p => ({ ...p, assets: [...p.assets, asset] }));
    setNotice(t("notice.assetAdded", { name: cleanName }));
  }
  function importAssetFile(file?: File) {
    if (!file) return;
    const mime = file.type.toLowerCase();
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const kind: AssetKind = mime.startsWith("video/") || ["mp4","mov","webm","m4v","mkv"].includes(ext) ? "video"
      : mime.startsWith("image/") || ["png","jpg","jpeg","webp","gif","avif"].includes(ext) ? "image"
      : mime.startsWith("audio/") || ["mp3","wav","m4a","aac","ogg","flac"].includes(ext) ? "audio"
      : ["js","mjs","ts","html"].includes(ext) ? "script" : "other";
    if (kind === "image") {
      if (file.size > 4 * 1024 * 1024) {
        setNotice("Image is too large for browser storage. Please use an image under 4 MB.");
        if (assetFileInput.current) assetFileInput.current.value = "";
        return;
      }
      const thumbnail = createImageThumbnail(file);
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          void thumbnail.then(thumbnailPath => {
            const assetId = id("asset");
            const asset: Asset = { id: assetId, name: file.name, kind: "image", path: reader.result as string, notes: "Imported image available for local preview.", ...(thumbnailPath ? { thumbnailPath } : {}) };
            change(p => ({ ...p, assets: [...p.assets, asset] }));
            setNotice(file.name + " imported with a preview thumbnail.");
          });
        }
        if (assetFileInput.current) assetFileInput.current.value = "";
      };
      reader.onerror = () => {
        setNotice("Could not read this image file.");
        if (assetFileInput.current) assetFileInput.current.value = "";
      };
      reader.readAsDataURL(file);
      return;
    }
    if (kind === "video" || kind === "audio") {
      const assetId = id("asset");
      const thumbnail = kind === "video" ? createVideoThumbnail(file) : Promise.resolve(undefined);
      void Promise.all([storeMediaAsset(assetId, file), thumbnail]).then(([path, thumbnailPath]) => {
        const asset: Asset = { id: assetId, name: file.name, kind, notes: "Imported media stored locally in IndexedDB.", path, ...(thumbnailPath ? { thumbnailPath } : {}) };
        change(p => ({ ...p, assets: [...p.assets, asset] }));
        setNotice(thumbnailPath ? file.name + " imported with a preview thumbnail." : file.name + " imported and ready for composition.");
      }).catch(error => {
        setNotice(error instanceof Error ? error.message : "Could not store the imported media file.");
      });
      if (assetFileInput.current) assetFileInput.current.value = "";
      return;
    }
    addAsset(file.name, kind, t("assets.importMetadataOnly"), file.name);
    if (assetFileInput.current) assetFileInput.current.value = "";
  }
  function updateAsset(assetId: string, patch: Partial<Asset>) {
    change(p => ({ ...p, assets: p.assets.map(a => a.id === assetId ? { ...a, ...patch, updatedAt: new Date().toISOString() } : a) }));
  }
  function chooseAssetUpload(kind: "audio" | "image") {
    setAssetUploadKind(kind);
    if (!assetFileInput.current) return;
    assetFileInput.current.accept = kind === "audio" ? "audio/*" : "image/*";
    assetFileInput.current.click();
    setShowAssetCreateMenu(false);
  }
  async function uploadAssetForTimeline(file?: File) {
    const track = projectRef.current.tracks.find(item => item.id === assetPickerTrackId);
    if (!file || !track || (track.kind !== "video" && track.kind !== "audio")) return;
    const assetId = id("asset");
    const clipId = id("timeline-clip");
    const kind: "video" | "audio" = track.kind === "audio" ? "audio" : "video";
    try {
      const [path, thumbnailPath] = await Promise.all([storeMediaAsset(assetId, file), kind === "video" ? createVideoThumbnail(file) : Promise.resolve(undefined)]);
      const now = new Date().toISOString();
      const asset: Asset = { id: assetId, name: file.name, kind, path, createdAt: now, updatedAt: now, notes: "Imported from Timeline; stored locally.", ...(thumbnailPath ? { thumbnailPath } : {}) };
      const duration = Math.max(.5, Math.min(3, mediaTimelineDuration - editorTime || 3));
      const clip: TimelineClip = { id: clipId, name: file.name.replace(/\\.[^.]+$/, ""), kind, trackId: track.id, start: Math.round(editorTime * Math.max(1, projectRef.current.frameRate || 24)) / Math.max(1, projectRef.current.frameRate || 24), duration, assetId, sourceIn: 0 };
      change(p => ({ ...p, assets: [...p.assets, asset], timelineClips: [...(p.timelineClips ?? []), clip] }));
      setSelectedTimelineClipId(clipId); setSelectedTimelineTrackId(track.id); setTimelineClipSettingsId(clipId); setAssetPickerTrackId("");
      setNotice(file.name + " imported to Assets and added to the Timeline.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not import this media file."); }
  }
  function removeAsset(assetId: string) {
    const usedByProfile = project.referenceProfiles.some(profile => profile.references.some(ref => ref.assetId === assetId));
    const usedByLayer = project.shots.some(shot => shot.slots.some(slot => slot.versions.some(version =>
      version.layers.some(layer => layer.assetId === assetId) ||
      version.generationRecords.some(record => record.outputAssetId === assetId || record.referenceSnapshot.some(ref => ref.assetId === assetId))
    )));
    const usedByOverride = project.shots.some(shot => shot.referenceOverrides.some(override => override.replacementAssetId === assetId));
    const usedByTimelineClip = (project.timelineClips ?? []).some(clip => clip.assetId === assetId);
    if (usedByProfile || usedByLayer || usedByOverride || usedByTimelineClip) { setNotice(t("notice.assetInUse")); return; }
    const removed = project.assets.find(asset => asset.id === assetId);
    change(p => ({ ...p, assets: p.assets.filter(a => a.id !== assetId) }));
    if (removed?.path && isStoredMediaPath(removed.path)) void deleteStoredMediaAsset(assetId).catch(error => setNotice(error instanceof Error ? error.message : "Could not delete the stored media file."));
    setNotice(t("notice.assetRemoved"));
  }
  function addReferenceProfile() {
    const name = profileDraftName.trim();
    if (!name) { setNotice(t("error.profileNameRequired")); return; }
    const profile: ReferenceProfile = { id: id("profile"), name, entityType: profileDraftType, references: [] };
    change(p => ({ ...p, referenceProfiles: [...p.referenceProfiles, profile] }));
    setSelectedProfileId(profile.id); setProfileDraftName(""); setShowProfileForm(false);
    setNotice(t("notice.profileAdded", { name }));
  }
  function createStoryboardFromReference(profileId: string) {
    const current = projectRef.current;
    const profile = current.referenceProfiles.find(item => item.id === profileId);
    if (!profile) return;
    const profileReferences = profile.references.filter(reference => current.assets.some(asset => asset.id === reference.assetId));
    const referenceSummary = profileReferences.map(reference => {
      const asset = current.assets.find(item => item.id === reference.assetId);
      return (reference.role + ": " + (asset?.name ?? "missing asset") + (reference.notes ? " (" + reference.notes + ")" : ""));
    }).join("\n");
    const shotId = id("shot");
    const slotId = id("slot");
    const versionId = id("version");
    const prompt = "Create a storyboard shot based on reference profile '" + profile.name + "' (" + profile.entityType + "). Preserve the referenced visual identity and apply the selected roles.\n" + (referenceSummary || "No reference assets attached yet.") + "\nShot intent: establish a clear visual beat; refine the prompt before sending it to an AI provider.";
    const version = {
      id: versionId, name: "Reference-led draft", description: "Draft scaffold generated locally from reference profile metadata; no image/video model was called.", duration: 5,
      layers: [{ id: id("layer"), name: "Reference-led visual", kind: "image" as const, start: 0, duration: 5, prompt, modelName: "Not generated", modelVersion: "metadata-only", fitMode: "contain" as const, x: 0, y: 0, width: 100, height: 100, opacity: 1 }],
      scriptVersionIds: [],
      generationRecords: [{ id: id("generation"), createdAt: new Date().toISOString(), prompt, referenceSnapshot: profileReferences.map(reference => ({ ...reference })), modelName: "Not generated", modelVersion: "metadata-only" }]
    };
    const shot: Shot = {
      id: shotId, title: String(current.shots.length + 1).padStart(2, "0") + " · " + profile.name + " reference shot",
      intent: "Reference-led storyboard draft. " + (referenceSummary || "Attach reference assets and refine this shot before generation."),
      duration: 5, status: "planned", referenceProfileIds: [profileId], referenceOverrides: [],
      slots: [{ id: slotId, name: "Reference-led storyboard", start: 0, duration: 5, selectedVersionId: versionId, versions: [version] }]
    };
    change(p => ({ ...p, shots: [...p.shots, shot] }));
    setSelectedId(shotId);
    setSelectedSlotId(slotId);
    setSelectedProfileId(profileId);
    setView("storyboard");
    setNotice("Created a reference-led storyboard draft and saved its reference snapshot. No AI provider was called.");
  }

  function updateReferenceProfile(profileId: string, patch: Partial<ReferenceProfile>) {
    change(p => ({ ...p, referenceProfiles: p.referenceProfiles.map(profile => profile.id === profileId ? { ...profile, ...patch } : profile) }));
  }
  function removeReferenceProfile(profileId: string) {
    const profile = project.referenceProfiles.find(item => item.id === profileId);
    const referenceIds = new Set((profile?.references ?? []).map(reference => reference.id));
    change(p => ({
      ...p,
      referenceProfiles: p.referenceProfiles.filter(item => item.id !== profileId),
      shots: p.shots.map(shot => ({
        ...shot,
        referenceProfileIds: shot.referenceProfileIds.filter(id => id !== profileId),
        referenceOverrides: shot.referenceOverrides.filter(override => !referenceIds.has(override.referenceId)),
      }))
    }));
    if (selectedProfileId === profileId) setSelectedProfileId("");
    setNotice(t("notice.profileRemoved"));
  }

  function addProfileReference(profileId: string) {
    if (!referenceAssetId) { setNotice(t("error.referenceAssetRequired")); return; }
    const reference = { id: id("reference"), assetId: referenceAssetId, role: referenceRole };
    change(p => ({ ...p, referenceProfiles: p.referenceProfiles.map(profile =>
      profile.id === profileId ? { ...profile, references: [...profile.references, reference] } : profile
    ) }));
    setNotice(t("notice.referenceAdded"));
  }
  function updateProfileReferenceRole(profileId: string, referenceId: string, role: ReferenceRole) {
    change(p => ({ ...p, referenceProfiles: p.referenceProfiles.map(profile => profile.id !== profileId ? profile : {
      ...profile, references: profile.references.map(reference => reference.id === referenceId ? { ...reference, role } : reference)
    }) }));
  }
  function removeProfileReference(profileId: string, referenceId: string) {
    change(p => ({
      ...p,
      referenceProfiles: p.referenceProfiles.map(profile => profile.id !== profileId ? profile : {
        ...profile, references: profile.references.filter(reference => reference.id !== referenceId)
      }),
      shots: p.shots.map(shot => ({
        ...shot,
        referenceOverrides: shot.referenceOverrides.filter(override => override.referenceId !== referenceId),
      }))
    }));
    setNotice(t("notice.referenceRemoved"));
  }

  function download(name: string, data: unknown) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  async function exportVideo() {
    setNotice("Rendering composition…");
    try { const result = await exportCompositionWebM(project); downloadExport(result); setNotice("Video export complete: " + result.filename); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Video export failed."); }
  }
  function exportProject() {
    download((project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "dionysus-project") + ".dionysus.json", project);
    setNotice(t("notice.projectExported"));
  }
  function exportPlan() {
    download("dionysus-execution-plan.json", {
      format: "dionysus-ai-execution-plan", schemaVersion: "1.0",
      project: { id: project.id, name: project.name, frameRate: project.frameRate, width: project.width, height: project.height },
      shots: project.shots.map((shot, index) => ({
        order: index + 1, id: shot.id, title: shot.title, intent: shot.intent,
        targetDurationSeconds: shot.duration, referenceProfileIds: shot.referenceProfileIds,
        referenceOverrides: shot.referenceOverrides, slots: shot.slots
      })),
      assets: project.assets, referenceProfiles: project.referenceProfiles, tracks: project.tracks
    });
    setNotice(t("notice.planExported"));
  }
  async function importProject(file?: File) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as DionysusProject;
      if (!validateProject(data)) throw new Error(t("error.invalidProject"));
      const normalized = normalizeLegacyTimelineTracks(data); setProject(normalized); setUndoStack([]); setRedoStack([]); lastHistoryGroup.current = ""; setSelectedId(normalized.shots[0]?.id ?? ""); setNotice(t("notice.projectImported"));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("error.importFailed"));
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  const nav: { id: View; label: string; icon: typeof Film }[] = [{ id: "storyboard", label: t("nav.storyboard"), icon: Clapperboard }, { id: "timeline", label: t("nav.timeline"), icon: Layers3 }, { id: "assets", label: t("nav.assets"), icon: Film }, { id: "references", label: t("nav.references"), icon: Sparkles }];
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><WandSparkles size={20}/></div><div><div className="brand-name">{t("brand.name")}</div><div className="brand-subtitle">{t("brand.subtitle")}</div></div></div>
      <div className="workspace-label">{t("nav.workspace")}</div>
      <button className="project-switcher" onClick={() => setNotice(t("notice.multiProjectPlanned"))}><div className="project-icon"><Film size={16}/></div><div className="project-switcher-copy"><strong>{project.name}</strong><span>{t("project.local")}</span></div><ChevronDown size={15}/></button>
      <div className="nav-label">{t("nav.create")}</div><nav className="side-nav">{nav.map(({ id: key, label, icon: Icon }) => <button key={key} className={"nav-item " + (view === key ? "active" : "")} onClick={() => setView(key)}><Icon size={17}/><span>{label}</span>{key === "storyboard" && <span className="nav-count">{project.shots.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="storage-card"><ShieldCheck size={16}/><div><strong>{t("storage.title")}</strong><span>{t("storage.description")}</span></div></div><button className="nav-item" onClick={() => setNotice(t("notice.projectSettingsPlanned"))}><Settings2 size={17}/><span>{t("nav.settings")}</span></button><button className="nav-item" onClick={() => setNotice(t("notice.helpDocs"))}><CircleHelp size={17}/><span>{t("nav.help")}</span></button><div className="user-chip"><div className="user-avatar">D</div><div><strong>{t("brand.name")}</strong><span>{t("user.workspace")}</span></div><span className="online-dot"/></div></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>{t("breadcrumb.projects")}</span><span className="crumb-sep">/</span><strong>{project.name}</strong><span className="local-pill"><span/> {t("status.localBadge")}</span></div><div className="top-actions"><button className="button button-quiet" onClick={() => fileInput.current?.click()}><FolderOpen size={15}/> {t("action.openProject")}</button><button className="button button-quiet" onClick={exportProject}><Save size={15}/> {t("action.exportProject")}</button><button className="button button-quiet button-small" aria-label="Undo" title="Undo" disabled={undoStack.length === 0} onClick={undoProjectChange}><Undo2 size={14}/> Undo</button><button className="button button-quiet button-small" aria-label="Redo" title="Redo" disabled={redoStack.length === 0} onClick={redoProjectChange}><Redo2 size={14}/> Redo</button><button className="button button-quiet" onClick={() => void exportVideo()}><Film size={15}/> Export WebM</button><button className="button button-primary" onClick={exportPlan}><Download size={15}/> {t("action.exportPlan")}</button><input ref={fileInput} type="file" accept=".json,.dionysus.json,application/json" hidden onChange={e => void importProject(e.target.files?.[0])}/></div></header>
      <div className="page-content">
        <section className={"page-heading" + (view === "timeline" ? " timeline-page-heading" : "")}><div><div className="eyebrow"><span className="eyebrow-line"/> {t("heading.eyebrow")}</div><h1>{view === "storyboard" ? t("heading.storyboard.title") : view === "timeline" ? t("heading.timeline.title") : view === "assets" ? t("heading.assets.title") : t("heading.references.title")}</h1><p>{view === "storyboard" ? t("heading.storyboard.description") : view === "timeline" ? t("heading.timeline.description") : view === "assets" ? t("heading.assets.description") : t("heading.references.description")}</p></div><div className="heading-meta"><span className="status-dot"/> {t("status.autosaved")} <span className="meta-divider"/> <span>{t("project.versionFoundation")}</span></div></section>
        {view !== "timeline" && <section className="project-overview"><div className="overview-main"><div className="overview-icon"><Clapperboard size={19}/></div><div className="overview-copy"><div className="overview-kicker">{t("project.current")}</div><input className="project-name-input" aria-label={t("project.name")} value={project.name} onChange={e => change(p => ({ ...p, name: e.target.value }))}/><div className="project-subline"><span><Clock3 size={13}/> {t("project.runtimeSummary", { duration: time(runtime) })}</span><span><Film size={13}/> {t("project.shotCount", { count: project.shots.length })}</span><span><Layers3 size={13}/> {t("project.clipSlotCount", { count: slotCount })}</span></div></div></div><div className="project-specs"><div><span>{t("project.canvas")}</span><strong>{project.width} × {project.height}</strong></div><div><span>{t("project.frameRate")}</span><strong>{project.frameRate} FPS</strong></div><button className="icon-button" title="Project canvas settings" aria-label="Project canvas settings" onClick={openProjectSettings}><Settings2 size={17}/></button></div></section>}
        <div className={"workbench" + (view === "timeline" ? " timeline-workbench" : "")}><section className="workbench-main">
          {view === "storyboard" && <><div className="section-toolbar"><div><h2>{t("storyboard.title")}</h2><p>{t("storyboard.shotCount", { count: project.shots.length })} · SeeDance node flow canvas</p></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={()=>setIsAgentModalOpen(true)}><Sparkles size={14} color="#d5f36a"/> AI Storyboard Plan</button><button className="button button-quiet button-small" onClick={()=>setIsChecklistOpen(true)}><CheckCircle2 size={14} color="#75d7c1"/> Production Guide</button><button className="button button-quiet button-small" onClick={()=>setStoryboardMode(m => m === "flow" ? "list" : "flow")}>{storyboardMode === "flow" ? <Layers3 size={14}/> : <Maximize2 size={14}/>} {storyboardMode === "flow" ? "Grid Cards" : "Node Flow Canvas"}</button><button className="button button-quiet button-small" onClick={syncStoryboardToTimeline}><Film size={14}/> Generate / update timeline</button><button className="button button-primary button-small" onClick={addShot}><Plus size={15}/> {t("action.addShot")}</button></div></div>{storyboardMode === "flow" ? <StoryboardFlowCanvas project={project} selectedShotId={selectedId} onSelectShot={setSelectedId} onUpdateShot={updateShot} onAddShot={addShot} onDeleteShot={removeShot} onDuplicateShot={duplicateShot} onAddConnection={addStoryboardConnection} onRemoveConnection={removeStoryboardConnection} onOpenAgentModal={()=>setIsAgentModalOpen(true)} onOpenChecklist={()=>setIsChecklistOpen(true)} onSyncTimeline={syncStoryboardToTimeline} onAttachAssetToShot={attachAssetToShot} onSelectVersion={(sId, slotId, vId) => { chooseSlotVersion(sId, slotId, vId); setSelectedSlotId(slotId); setView("timeline"); }}/> : <div className="shot-list">{project.shots.map((shot, i) => <article key={shot.id} role="button" tabIndex={0} className={"shot-card " + (selected?.id === shot.id ? "selected" : "")} onClick={() => setSelectedId(shot.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(shot.id); } }}><div className="shot-number">{String(i + 1).padStart(2, "0")}</div><div className="shot-thumb"><div className="thumb-grid"/><div className="thumb-center"><Film size={21}/></div><span>{time(shot.duration)}</span></div><div className="shot-card-body"><div className="shot-title-row"><h3>{shot.title}</h3><span className={"shot-status status-" + shot.status}>{t(("status." + shot.status) as "status.planned" | "status.in-progress" | "status.ready")}</span></div><p>{shot.intent || t("shot.emptyIntent")}</p><div className="shot-card-meta"><span><Layers3 size={13}/> {t("shot.clipSlotCount", { count: shot.slots.length })}</span><span><Clock3 size={13}/> {t("shot.durationTarget", { duration: shot.duration })}</span></div></div><div className="shot-arrow">↗</div><button type="button" className="shot-version-toggle" aria-expanded={expandedVersionShotId === shot.id} onClick={e => { e.stopPropagation(); setExpandedVersionShotId(expandedVersionShotId === shot.id ? "" : shot.id); }}><ChevronDown size={13}/><span>{shot.slots.reduce((n, slot) => n + slot.versions.length, 0)} versions</span></button>{expandedVersionShotId === shot.id && <div className="shot-version-dropdown" onClick={e => e.stopPropagation()}>{shot.slots.flatMap(slot => slot.versions.map((version, vi) => ({slot, version, vi}))).map(({slot,version,vi}) => <button type="button" key={version.id} className={"shot-version-option" + (version.id === slot.selectedVersionId ? " active" : "")} onClick={() => { setSelectedId(shot.id); setSelectedSlotId(slot.id); chooseSlotVersion(shot.id,slot.id,version.id); setView("timeline"); }}><span>{slot.name} · {version.name || "Version " + (vi+1)}</span><small>{version.duration}s · {version.layers.length} layers</small></button>)}</div>}</article>)}<button className="add-shot-card" onClick={addShot}><span><Plus size={17}/></span><strong>{t("shot.addAnother")}</strong><small>{t("shot.addAnotherHint")}</small></button></div>}</>}
          {view === "timeline" && <><div className="timeline-workspace-bar"><div className="timeline-workspace-tabs" role="tablist" aria-label="Timeline tabs">
  <button role="tab" aria-selected={activeTimelineTabId === "master"} className={activeTimelineTabId === "master" ? "active" : ""} onClick={() => activateTimelineTab("master")}>Master Timeline</button>
  {timelineTabs.map(tab => <div className={"timeline-workspace-tab " + (activeTimelineTabId === tab.id ? "active" : "")} key={tab.id}>
    <button role="tab" aria-selected={activeTimelineTabId === tab.id} onClick={() => { setSelectedId(tab.shotId); setSelectedSlotId(tab.slotId); activateTimelineTab(tab.id); }}>{tab.label}</button>
    <button className="timeline-tab-close" aria-label={"Close " + tab.label} onClick={() => closeTimelineTab(tab.id)}>×</button>
  </div>)}
</div></div>
<div className="timeline-tab-content master-timeline-content" style={{display:activeTimelineTabId === "master" ? "block" : "none"}}>{renderTimelinePreview("master", "Master preview", activeShotInfo.shot?.title ?? project.name, runtime, activeShotInfo.shot?.title ?? project.name, activeShotInfo.shot?.intent ?? "", true)}<div className="section-toolbar timeline-master-actions"><span className="timeline-summary">{project.shots.length} shots · {(project.timelineClips ?? []).length} clips</span><div className="inline-actions"><button className="button button-quiet button-small" onClick={saveMasterTimelineAsClipAsset}><Save size={14}/> Save as Clip Asset</button><button className="button button-primary button-small" disabled={!selected} onClick={() => selected && addSlot(selected.id)}><Plus size={15}/> {t("action.addClipSlot")}</button></div></div><div className="timeline-ruler" role="slider" aria-label="Master timeline playhead" aria-valuemin={0} aria-valuemax={runtime} aria-valuenow={editorTime} tabIndex={0}
            onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); const next = Math.max(0, Math.min(runtime, ((event.clientX - rect.left) / Math.max(rect.width, 1)) * runtime)); playbackTimeRef.current = next; setIsPlaying(false); setEditorTime(next); }}
            onPointerMove={event => { if (event.buttons !== 1) return; const rect = event.currentTarget.getBoundingClientRect(); const next = Math.max(0, Math.min(runtime, ((event.clientX - rect.left) / Math.max(rect.width, 1)) * runtime)); playbackTimeRef.current = next; setIsPlaying(false); setEditorTime(next); }}
            onKeyDown={event => { if (event.key === "ArrowRight") { const next = Math.min(runtime, editorTime + 0.5); playbackTimeRef.current = next; setIsPlaying(false); setEditorTime(next); } if (event.key === "ArrowLeft") { const next = Math.max(0, editorTime - 0.5); playbackTimeRef.current = next; setIsPlaying(false); setEditorTime(next); } }}>
            <div className="integrated-ruler-playhead" style={{ left: (editorTime / Math.max(runtime, 1) * 100) + "%" }}/>
            {Array.from({ length: Math.floor(runtime / 5) + 1 }, (_, i) => i * 5).concat(runtime % 5 === 0 ? [] : [runtime]).map(seconds => <span key={seconds} style={{ left: (seconds / Math.max(runtime, 1) * 100) + "%" }}>{time(seconds)}</span>)}
          </div><div className="timeline-scroll">{project.tracks.map((track, i) => <div className="timeline-track" key={track.id}><div className="track-label">{track.kind === "audio" ? <AudioLines size={14}/> : track.kind === "text" ? <Sparkles size={14}/> : <Film size={14}/>}<span>{t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects")}</span></div><div className="track-lane" style={{ backgroundSize: (5 / Math.max(runtime, 1) * 100) + "% 100%" }}>{i === 0 && project.shots.map((shot, si) => <button key={shot.id} className={"timeline-shot " + (selected?.id === shot.id ? "chosen" : "")} style={{ left: (getMasterShotStarts(project.shots)[si] / Math.max(runtime, 1) * 100) + "%", width: (shot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => setSelectedId(shot.id)}><span>{shot.title}</span><small>{shot.duration}s</small></button>)}{i === 1 && selected?.slots.map(slot => <button key={slot.id} className="timeline-slot" style={{ left: ((selectedStart + slot.start) / Math.max(runtime, 1) * 100) + "%", width: (slot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => selectClipSlot(slot.id)}><span>{slot.name}</span><small>{slot.versions.find(v => v.id === slot.selectedVersionId)?.name ?? "No version"}</small></button>)}{i > 1 && <div className="track-empty"><span>+</span> {t("timeline.trackAddLayer", { kind: t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects") })}</div>}</div></div>)}</div><section className="editor-linked-timeline visual-timeline" aria-label="Media timeline">
<div className="editor-linked-heading"><div><strong>Timeline layers</strong><span>{(project.timelineClips ?? []).length} clips · right-click a layer or clip for settings</span></div><div className="inline-actions layer-add-menu-wrap">
 <button className="button button-primary button-small" aria-haspopup="menu" aria-expanded={showAddLayerMenu} onClick={()=>setShowAddLayerMenu(value=>!value)}><Plus size={14}/> Add layer <ChevronDown size={13}/></button>
 <div className="layer-add-menu" role="menu" hidden={!showAddLayerMenu}>

  <button role="menuitem" onClick={()=>{change(p=>({...p,tracks:[...p.tracks,{id:id("track-video"),name:"Video "+(p.tracks.filter(track=>track.kind==="video").length+1),kind:"video"}]}));setShowAddLayerMenu(false);}}>Video layer</button>
  <button role="menuitem" onClick={()=>{change(p=>({...p,tracks:[...p.tracks,{id:id("track-audio"),name:"Audio "+(p.tracks.filter(track=>track.kind==="audio").length+1),kind:"audio"}]}));setShowAddLayerMenu(false);}}>Audio layer</button>
  <button role="menuitem" onClick={()=>{change(p=>({...p,tracks:[...p.tracks,{id:id("track-text"),name:"Text "+(p.tracks.filter(track=>track.kind==="text").length+1),kind:"text"}]}));setShowAddLayerMenu(false);}}>Text layer</button>
 </div><button className={"button button-quiet button-small ripple-reorder-toggle"+(rippleReorderMode?" active":"")} aria-pressed={rippleReorderMode} onClick={()=>setRippleReorderMode(enabled=>!enabled)}>{rippleReorderMode?"Ripple Reorder: ON":"Ripple Reorder"}</button>
</div></div>
{rippleReorderMode&&<p className="ripple-mode-note" role="status">Ripple Reorder is ON. Dropping a Shot changes chronological order and packs the full Master sequence back-to-back, closing gaps. Master durations and Version internals stay unchanged.</p>}
<div className="visual-track-list">
{project.tracks.filter(track=>track.kind==="video"||track.kind==="audio"||track.kind==="text").map(track=>{
 const clips=(project.timelineClips??[]).filter(clip=>clip.trackId===track.id && !(track.kind==="audio" && clip.linkedVideoClipId));
 return <div className="visual-track-group" key={track.id}>
 <div className="visual-track-row">
  <div className={"visual-track-label"+(selectedTimelineTrackId===track.id?" selected-track-label":"")} onClick={()=>setSelectedTimelineTrackId(track.id)} onContextMenu={event=>{event.preventDefault();setTrackContextMenuId(track.id);setTrackContextMenuPosition({x:Math.min(event.clientX,window.innerWidth-190),y:Math.min(event.clientY,window.innerHeight-180)});setSelectedTimelineTrackId(track.id);}}>
   {track.kind==="video" && <button className="track-expand-toggle" aria-label={(collapsedVideoTrackIds.includes(track.id)?"Expand ":"Collapse ")+track.name} aria-expanded={!collapsedVideoTrackIds.includes(track.id)} onClick={()=>setCollapsedVideoTrackIds(current=>current.includes(track.id)?current.filter(id=>id!==track.id):[...current,track.id])}>{collapsedVideoTrackIds.includes(track.id)?"▸":"▾"}</button>}
   <span className={track.kind==="audio"?"track-kind-audio":"track-kind-video"}>{track.kind==="audio"?<AudioLines size={15}/>:track.kind==="procedural"?<Code2 size={15}/>:track.kind==="text"?<Sparkles size={15}/>:<Film size={15}/>}</span><div><strong>{track.name||track.kind}</strong><small>{track.kind==="audio"?"Audio layer":track.kind==="procedural"?"Code layer":track.kind==="text"?"Text layer":track.kind==="effects"?"Effects layer":"Video layer"}</small></div>{track.kind==="video" && <button type="button" className="track-settings-button" title="Video layer settings" aria-label={"Settings for "+track.name} onClick={event=>{event.stopPropagation();setVideoTrackSettingsId(track.id);}}><Settings2 size={14}/></button>}{track.kind==="audio" && <button className={"track-layer-mute"+(track.muted?" muted":"")} aria-label={(track.muted?"Unmute ":"Mute ")+track.name+" layer"} aria-pressed={Boolean(track.muted)} title={track.muted?"Unmute audio layer":"Mute audio layer"} onClick={event=>{event.stopPropagation();change(p=>({...p,tracks:p.tracks.map(item=>item.id===track.id?{...item,muted:!item.muted}:item)}));}}>{track.muted?"Unmute":"Mute"}</button>}<button className="track-add-clip" aria-label={"Add clip to "+track.name} title={"Add clip to "+track.name} onClick={event=>{event.stopPropagation();if(track.kind==="effects"){setNotice("Effects layer clips are not yet supported.");return;}if(track.kind==="video"||track.kind==="audio"){setAssetPickerTrackId(track.id);setAssetPickerSearch("");setAssetPickerFilter(track.kind==="audio"?"audio":"all");return;}const kind=track.kind==="text"?"text":"procedural";const clipId=id("timeline-clip");const duration=Math.max(.5,Math.min(3,mediaTimelineDuration-editorTime||3));change(p=>({...p,timelineClips:[...(p.timelineClips??[]),{id:clipId,name:(kind==="procedural"?"Code":kind==="text"?"Text":kind==="audio"?"Audio":"Video")+" clip "+((p.timelineClips??[]).filter(clip=>clip.trackId===track.id).length+1),kind,trackId:track.id,start:Math.round(editorTime*Math.max(1,p.frameRate||24))/Math.max(1,p.frameRate||24),duration}]}));setSelectedTimelineClipId(clipId);setTimelineClipSettingsId(clipId);}}><Plus size={13}/></button><button className="track-remove-button" aria-label={"Remove "+track.name+" layer"} title={"Remove "+track.name+" layer"} onClick={event=>{event.stopPropagation();if(window.confirm("Remove layer “"+track.name+"” and all clips on it?")){change(p=>({...p,tracks:p.tracks.filter(item=>item.id!==track.id),timelineClips:(p.timelineClips??[]).filter(clip=>clip.trackId!==track.id&&!(clip.linkedVideoClipId&&(p.timelineClips??[]).some(source=>source.id===clip.linkedVideoClipId&&source.trackId===track.id)))}));setSelectedTimelineClipId("");setTimelineClipSettingsId("");}}}><span aria-hidden="true">×</span></button>
  </div>
  <div className="visual-track-lane" style={{backgroundSize:(5/mediaTimelineDuration*100)+"% 100%",backgroundColor:track.kind==="video"?(track.backgroundTransparent?"transparent":track.backgroundColor??"#111113"):undefined,backgroundImage:track.kind==="video"&&track.backgroundTransparent?"none":undefined}}
   onContextMenu={event=>{event.preventDefault();setTrackContextMenuId(track.id);setTrackContextMenuPosition({x:Math.min(event.clientX,window.innerWidth-190),y:Math.min(event.clientY,window.innerHeight-180)});setSelectedTimelineTrackId(track.id);}} onPointerDown={event=>{if(event.target!==event.currentTarget)return;setSelectedTimelineTrackId(track.id);const rect=event.currentTarget.getBoundingClientRect();const next=Math.max(0,Math.min(activeTimelineDuration,((event.clientX-rect.left)/Math.max(rect.width,1))*mediaTimelineDuration));playbackTimeRef.current=next;setIsPlaying(false);setEditorTime(next);}}
   onDragOver={event=>{event.preventDefault();const moving=clipDragSourceRef.current;if(!moving)return;const rect=event.currentTarget.getBoundingClientRect();const pointerTime=((event.clientX-rect.left)/Math.max(rect.width,1))*mediaTimelineDuration;const fps=Math.max(1,project.frameRate||24);const start=findNonOverlappingClipStart(project.timelineClips??[],moving.id,track.id,pointerTime-moving.duration/2,moving.duration,mediaTimelineDuration,fps);setClipDropPreview({trackId:track.id,start,duration:moving.duration,name:moving.name});}}
   onDrop={event=>{
     event.preventDefault();
     const rect=event.currentTarget.getBoundingClientRect();
     const masterShotId=event.dataTransfer.getData("text/dionysus-master-shot");
     if(masterShotId){
       const movingShot=project.shots.find(shot=>shot.id===masterShotId);
       if(!movingShot||track.kind!=="video")return;
       const fps=Math.max(1,project.frameRate||24);
       const pointerTime=((event.clientX-rect.left)/Math.max(rect.width,1))*mediaTimelineDuration;
       let next:number;
       if(rippleReorderMode){
         const targetCenter=Math.round(pointerTime*fps)/fps;
         const reordered=rippleReorderMasterShots(project.shots,movingShot.id,targetCenter);
         next=getMasterShotStart(reordered,movingShot.id);
         change(p=>({...p,shots:rippleReorderMasterShots(p.shots,movingShot.id,targetCenter)}),"shot-ripple-reorder");
         setNotice("Ripple Reorder applied: Shots were packed into the new order and gaps closed. Version internals were preserved.");
       }else{
         const maxStart=Math.max(0,mediaTimelineDuration-movingShot.duration);
         const rawStart=Math.max(0,Math.min(maxStart,pointerTime-movingShot.duration/2));
         const snapped=Math.round(rawStart*fps)/fps;
         const maxFrameStart=Math.max(0,Math.floor(maxStart*fps)/fps);
         next=Math.min(maxFrameStart,snapped);
         updateMasterShotStart(movingShot.id,next);
       }
       setSelectedId(movingShot.id);
       setIsPlaying(false);
       playbackTimeRef.current=next;
       setEditorTime(next);
       return;
     }
     const clipId=event.dataTransfer.getData("text/dionysus-timeline-clip");
     const moving=(project.timelineClips??[]).find(clip=>clip.id===clipId);
     if(!moving||moving.kind!==track.kind||!(track.kind==="video"||track.kind==="audio"||track.kind==="text"||track.kind==="procedural"))return;
     const fps=Math.max(1,project.frameRate||24);
     const pointerTime=((event.clientX-rect.left)/Math.max(rect.width,1))*mediaTimelineDuration;
     const rawStart=Math.max(0,pointerTime-moving.duration/2);
     const snappedStart=Math.round(rawStart*fps)/fps;
     const next=clipDropPreview?.trackId===track.id?clipDropPreview.start:findNonOverlappingClipStart(project.timelineClips??[],moving.id,track.id,snappedStart,moving.duration,mediaTimelineDuration,fps);
     try{change(p=>{const result=moveTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},moving.id,next);return {...p,timelineClips:result.timelineClips.map(clip=>clip.id===moving.id?{...clip,trackId:track.id}:clip)};});setSelectedTimelineClipId(moving.id);setSelectedTimelineTrackId(track.id);setIsPlaying(false);setNotice("Clip snapped into a non-overlapping position.");}catch(error){setNotice(error instanceof Error?error.message:"Could not move the clip.");}finally{clipDragSourceRef.current=null;setClipDropPreview(null);}
   }}>
   <div className="visual-playhead" style={{left:(editorTime/mediaTimelineDuration*100)+"%"}}/>
   {clipDropPreview?.trackId===track.id && <div className="clip-drop-preview" style={{left:(clipDropPreview.start/mediaTimelineDuration*100)+"%",width:Math.max(2,clipDropPreview.duration/mediaTimelineDuration*100)+"%"}}><strong>{clipDropPreview.name}</strong><small>{clipDropPreview.start.toFixed(2)}s · {clipDropPreview.duration.toFixed(2)}s</small></div>}
   {clips.map(clip=>{
     const versionShot=clip.shotId?project.shots.find(shot=>shot.id===clip.shotId):selected;
     const versionSlot=versionShot?(clip.slotId?versionShot.slots.find(slot=>slot.id===clip.slotId):versionShot.slots.find(slot=>slot.id===selectedSlotId)??versionShot.slots[0]):undefined;
     const activeVersion=versionSlot?.versions.find(version=>version.id===versionSlot.selectedVersionId);
     const activeVisualLayer=activeVersion?.layers.find(layer=>layer.kind==="video"||layer.kind==="image");
     const clipAsset=clip.assetId?project.assets.find(asset=>asset.id===clip.assetId):undefined;
     const activeVisualAsset=activeVisualLayer?.assetId?project.assets.find(asset=>asset.id===activeVisualLayer.assetId):undefined;
     const thumbnailPath=clip.thumbnailPath??getAssetThumbnail(clipAsset)??activeVisualLayer?.thumbnailPath??getAssetThumbnail(activeVisualAsset);
     return <div className="visual-media-clip-wrap" key={clip.id} style={{left:((clipResizePreview?.id===clip.id?clipResizePreview.start:clip.start)/mediaTimelineDuration*100)+"%",width:Math.max(2,(clipResizePreview?.id===clip.id?clipResizePreview.duration:clip.duration)/mediaTimelineDuration*100)+"%",opacity:track.kind==="video"?(track.opacity??1):1}}>
       <button draggable className={"visual-media-clip "+(clip.kind==="audio"?"audio-clip "+(clip.assetId?"audio-has-source":"audio-placeholder"):clip.kind==="text"?"text-clip":clip.kind==="procedural"?"procedural-clip":"video-clip "+(clip.assetId?"video-has-source":"video-placeholder"))+(clip.id===selectedTimelineClipId?" selected":"")} onDragStart={event=>{event.dataTransfer.setData("text/dionysus-timeline-clip",clip.id);event.dataTransfer.effectAllowed="move";clipDragSourceRef.current=clip;setClipDropPreview({trackId:clip.trackId,start:clip.start,duration:clip.duration,name:clip.name});}} onDragEnd={()=>{clipDragSourceRef.current=null;setClipDropPreview(null);}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setSelectedTimelineClipId(clip.id);setClipContextMenuId(clip.id);setClipContextMenuPosition({x:Math.min(event.clientX,window.innerWidth-190),y:Math.min(event.clientY,window.innerHeight-180)});}} onDoubleClick={()=>setTimelineClipSettingsId(clip.id)} onClick={()=>{setSelectedTimelineClipId(clip.id);setSelectedTimelineTrackId(track.id);const next=Math.min(activeTimelineDuration,clip.start);playbackTimeRef.current=next;setIsPlaying(false);setEditorTime(next);}} style={{backgroundColor:clip.kind==="video"&&!clip.assetId?(track.backgroundTransparent?"transparent":track.backgroundColor??"#20232a"):undefined}} title={clip.name+" · "+clip.start.toFixed(1)+"–"+(clip.start+clip.duration).toFixed(1)+"s"}><span className="visual-clip-icon">{clip.kind==="audio"?<AudioLines size={13}/>:clip.kind==="text"?<Sparkles size={13}/>:clip.kind==="procedural"?<Layers3 size={13}/>:thumbnailPath?<img className="visual-clip-thumbnail" src={thumbnailPath} alt=""/>:<span className="visual-clip-thumbnail-placeholder"><Film size={13}/></span>}</span><span className="visual-clip-copy"><strong>{clip.name}</strong><small>{clip.duration.toFixed(1)}s{clip.linkedVideoClipId?" · linked":clip.kind==="audio"?" · independent":""}{clip.assetId?"":" · no source"}</small></span>{clip.kind==="audio"&&<AudioWaveform path={project.assets.find(asset=>asset.id===clip.assetId)?.path}/>}<span className="clip-resize-handle clip-resize-left" role="separator" aria-label={"Resize start of "+clip.name} onPointerDown={event=>{event.preventDefault();event.stopPropagation();const lane=event.currentTarget.closest(".visual-track-lane") as HTMLElement|null;clipResizeRef.current={id:clip.id,edge:"left",pointerId:event.pointerId,x:event.clientX,start:clip.start,duration:clip.duration,laneWidth:lane?.getBoundingClientRect().width??1};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{const active=clipResizeRef.current;if(!active||active.id!==clip.id||active.pointerId!==event.pointerId)return;const fps=Math.max(1,project.frameRate||24),frame=1/fps;const delta=Math.round(((event.clientX-active.x)/Math.max(active.laneWidth,1))*mediaTimelineDuration*fps)/fps;const others=(project.timelineClips??[]).filter(item=>item.trackId===clip.trackId&&item.id!==clip.id).sort((a,b)=>a.start-b.start);const previous=others.filter(item=>item.start+item.duration<=active.start+0.0001).at(-1);const end=active.start+active.duration;const start=Math.max(previous?previous.start+previous.duration:0,Math.min(end-frame,active.start+delta));setClipResizePreview({id:clip.id,start,duration:end-start});}} onPointerUp={event=>{const active=clipResizeRef.current;if(!active||active.id!==clip.id)return;const fps=Math.max(1,project.frameRate||24),frame=1/fps;const delta=Math.round(((event.clientX-active.x)/Math.max(active.laneWidth,1))*mediaTimelineDuration*fps)/fps;const others=(project.timelineClips??[]).filter(item=>item.trackId===clip.trackId&&item.id!==clip.id).sort((a,b)=>a.start-b.start);const previous=others.filter(item=>item.start+item.duration<=active.start+0.0001).at(-1);const end=active.start+active.duration;const start=Math.max(previous?previous.start+previous.duration:0,Math.min(end-frame,active.start+delta));change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id===clip.id?{...item,start,duration:end-start}:clip.kind==="video"&&item.kind==="audio"&&item.linkedVideoClipId===clip.id?withDurationAndClampedFades({...item,start},end-start):item)}));clipResizeRef.current=null;setClipResizePreview(null);}}/><span className="clip-resize-handle clip-resize-right" role="separator" aria-label={"Resize end of "+clip.name} onPointerDown={event=>{event.preventDefault();event.stopPropagation();const lane=event.currentTarget.closest(".visual-track-lane") as HTMLElement|null;clipResizeRef.current={id:clip.id,edge:"right",pointerId:event.pointerId,x:event.clientX,start:clip.start,duration:clip.duration,laneWidth:lane?.getBoundingClientRect().width??1};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{const active=clipResizeRef.current;if(!active||active.id!==clip.id||active.pointerId!==event.pointerId)return;const fps=Math.max(1,project.frameRate||24),frame=1/fps;const delta=Math.round(((event.clientX-active.x)/Math.max(active.laneWidth,1))*mediaTimelineDuration*fps)/fps;const others=(project.timelineClips??[]).filter(item=>item.trackId===clip.trackId&&item.id!==clip.id).sort((a,b)=>a.start-b.start);const next=others.find(item=>item.start>=active.start+active.duration-0.0001);const maxDuration=next?next.start-active.start:mediaTimelineDuration-active.start;setClipResizePreview({id:clip.id,start:active.start,duration:Math.max(frame,Math.min(maxDuration,active.duration+delta))});}} onPointerUp={event=>{const active=clipResizeRef.current;if(!active||active.id!==clip.id)return;const fps=Math.max(1,project.frameRate||24),frame=1/fps;const delta=Math.round(((event.clientX-active.x)/Math.max(active.laneWidth,1))*mediaTimelineDuration*fps)/fps;const others=(project.timelineClips??[]).filter(item=>item.trackId===clip.trackId&&item.id!==clip.id).sort((a,b)=>a.start-b.start);const next=others.find(item=>item.start>=active.start+active.duration-0.0001);const maxDuration=next?next.start-active.start:mediaTimelineDuration-active.start;const duration=Math.max(frame,Math.min(maxDuration,active.duration+delta));change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id===clip.id?{...item,duration}:clip.kind==="video"&&item.kind==="audio"&&item.linkedVideoClipId===clip.id?withDurationAndClampedFades(item,duration):item)}));clipResizeRef.current=null;setClipResizePreview(null);}}/></button>
       {clip.kind==="audio" && <button className="timeline-clip-mute" aria-label={(clip.muted?"Unmute ":"Mute ")+clip.name} aria-pressed={Boolean(clip.muted)} onClick={()=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id===clip.id?{...item,muted:!item.muted}:item)}))}>{clip.muted?"🔇":"♪"}</button>}
       {clip.kind==="video" && versionShot && versionSlot && <details className="timeline-version-menu"><summary aria-label={"Show versions for "+versionShot.title}>▾</summary><div className="timeline-version-menu-panel">
         <strong>{versionShot.title}</strong>
         {versionSlot.versions.map((version,vi)=><div className="timeline-version-menu-row" key={version.id}>
           <button className={version.id===versionSlot.selectedVersionId?"chosen":""} onClick={()=>{setSelectedId(versionShot.id);setSelectedSlotId(versionSlot.id);chooseSlotVersion(versionShot.id,versionSlot.id,version.id);}}><span>{version.name||"Version "+(vi+1)}</span><small>{version.layers.some(layer=>layer.kind==="procedural")?"Code / mix":version.layers.some(layer=>layer.kind==="video")?"Video":version.layers.some(layer=>layer.kind==="image")?"Image":"Composition"} · {version.duration}s</small></button>
           <button className="timeline-version-edit" onClick={()=>openVersionTimeline(versionShot.id,versionSlot.id,version.id)}>Edit</button>
         </div>)}
         <button className="timeline-version-add" onClick={()=>{setSelectedId(versionShot.id);setSelectedSlotId(versionSlot.id);createSlotVersion(versionShot.id,versionSlot.id);}}>＋ Add Version</button>
       </div></details>}
     </div>;
   })}
   {track.kind==="video" && project.tracks.find(item=>item.kind==="video")?.id===track.id && project.shots.map((shot,shotIndex)=>{
     const shotStart=getMasterShotStarts(project.shots)[shotIndex];
     const slot=shot.slots.find(item=>item.id===selectedSlotId)??shot.slots[0];
     const version=slot?.versions.find(item=>item.id===slot.selectedVersionId)??slot?.versions[0];
     const thumb=version ? renderVersionThumbnail(version, track.backgroundTransparent ? "transparent" : track.backgroundColor ?? "#111113") : <div className="version-thumbnail-preview" style={{backgroundColor:track.backgroundTransparent?"transparent":track.backgroundColor??"#111113"}}/>;
     return <div className="master-shot-clip-wrap" key={"master-shot-"+shot.id} style={{left:((shotResizePreview?.id===shot.id?shotResizePreview.start:shotStart)/mediaTimelineDuration*100)+"%",width:Math.max(2,(shotResizePreview?.id===shot.id?shotResizePreview.duration:shot.duration)/mediaTimelineDuration*100)+"%",opacity:track.opacity??1}}>
       <button draggable className={"master-shot-clip"+(selected?.id===shot.id?" selected":"")} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setSelectedId(shot.id);if(slot)setSelectedSlotId(slot.id);setShotContextMenuPosition({x:Math.min(event.clientX,window.innerWidth-180),y:Math.min(event.clientY,window.innerHeight-170)});setShotContextMenuId(shot.id);}} onDragStart={event=>{event.dataTransfer.setData("text/dionysus-master-shot",shot.id);event.dataTransfer.effectAllowed="move";}} onClick={()=>{setShotContextMenuId("");setSelectedId(shot.id);if(slot)setSelectedSlotId(slot.id);setIsPlaying(false);setEditorTime(shotStart);playbackTimeRef.current=shotStart;}} title={shot.title+" · "+shot.duration.toFixed(1)+"s"}>
         {thumb}
         <span className="master-shot-copy"><strong>{shot.title}</strong><small>{version?.name??"No version"} · {(shotResizePreview?.id===shot.id?shotResizePreview.duration:shot.duration).toFixed(1)}s</small></span>
         <span className="master-shot-resize-handle left" role="separator" aria-label={"Resize start of "+shot.title} onPointerDown={event=>beginMasterShotResize(event,shot,shotStart,"left")} onPointerMove={event=>moveMasterShotResize(event,shot)} onPointerUp={event=>endMasterShotResize(event,shot)}/>
         <span className="master-shot-resize-handle right" role="separator" aria-label={"Resize end of "+shot.title} onPointerDown={event=>beginMasterShotResize(event,shot,shotStart,"right")} onPointerMove={event=>moveMasterShotResize(event,shot)} onPointerUp={event=>endMasterShotResize(event,shot)}/>
       </button>
       {slot && <details className="timeline-version-menu master-shot-version-menu"><summary aria-label={"Show versions for "+shot.title}>▾</summary><div className="timeline-version-menu-panel">
         <strong>{shot.title}</strong>
         {slot.versions.map((item,vi)=><div className="timeline-version-menu-row" key={item.id}>
           <button className={item.id===slot.selectedVersionId?"chosen":""} onClick={()=>{setSelectedId(shot.id);setSelectedSlotId(slot.id);chooseSlotVersion(shot.id,slot.id,item.id);}}><span className="timeline-version-menu-thumb">{renderVersionThumbnail(item, track.backgroundTransparent ? "transparent" : track.backgroundColor ?? "#111113")}</span><span>{item.name||"Version "+(vi+1)}</span><small>{item.layers.some(layer=>layer.kind==="procedural")?"Code / mix":item.layers.some(layer=>layer.kind==="video")?"Video":item.layers.some(layer=>layer.kind==="image")?"Image":"Composition"} · {item.duration}s</small></button>
           <button className="timeline-version-edit" onClick={()=>openVersionTimeline(shot.id,slot.id,item.id)}>Edit</button>
         </div>)}
         <button className="timeline-version-add" onClick={()=>{setSelectedId(shot.id);setSelectedSlotId(slot.id);createSlotVersion(shot.id,slot.id);}}>＋ Add Version</button>
       </div></details>}
     </div>;
   })}
   {!clips.length && !(track.kind==="video" && project.tracks.find(item=>item.kind==="video")?.id===track.id && project.shots.length>0) && <span className="visual-track-empty">{track.kind==="procedural"?"Drop or add a Code clip to this lane":track.kind==="text"?"Drop or add a text clip to this lane":track.kind==="effects"?"No effects assigned to this lane.":"Drop or add a clip to this lane"}</span>}
  </div>
 </div>
 {track.kind==="video" && !collapsedVideoTrackIds.includes(track.id) && clips.filter(clip=>clip.kind==="video").map(videoClip=>{
   const linkedAudio=(project.timelineClips??[]).filter(clip=>clip.kind==="audio"&&clip.linkedVideoClipId===videoClip.id);
   if(!linkedAudio.length)return null;
   return <div className="visual-track-row linked-audio-child" key={"linked-"+videoClip.id}>
    <div className="visual-track-label"><span className="track-kind-audio"><AudioLines size={14}/></span><div><strong>Linked audio</strong><small>{videoClip.name}</small></div></div>
    <div className="visual-track-lane" style={{backgroundSize:(5/mediaTimelineDuration*100)+"% 100%"}}>
      <div className="visual-playhead" style={{left:(editorTime/mediaTimelineDuration*100)+"%"}}/>
      {linkedAudio.map(audio=><div className="visual-media-clip-wrap" key={audio.id} style={{left:(audio.start/mediaTimelineDuration*100)+"%",width:Math.max(2,audio.duration/mediaTimelineDuration*100)+"%"}}>
        <button className={"visual-media-clip audio-clip "+(audio.assetId?"audio-has-source":"audio-placeholder")+(audio.id===selectedTimelineClipId?" selected":"")} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setSelectedTimelineClipId(audio.id);setClipContextMenuId(audio.id);setClipContextMenuPosition({x:Math.min(event.clientX,window.innerWidth-190),y:Math.min(event.clientY,window.innerHeight-180)});}} onDoubleClick={()=>setTimelineClipSettingsId(audio.id)} onClick={()=>{setSelectedTimelineClipId(audio.id);setSelectedTimelineTrackId(track.id);setEditorTime(audio.start);setIsPlaying(false);playbackTimeRef.current=audio.start;}} title={audio.name+" · "+audio.duration.toFixed(1)+"s"}><span className="visual-clip-icon"><AudioLines size={13}/></span><span className="visual-clip-copy"><strong>{audio.name}</strong><small>{audio.duration.toFixed(1)}s · linked</small></span><AudioWaveform path={project.assets.find(asset=>asset.id===audio.assetId)?.path}/></button>
        <button className="timeline-clip-mute" aria-label={(audio.muted?"Unmute ":"Mute ")+audio.name} aria-pressed={Boolean(audio.muted)} onClick={()=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id===audio.id?{...item,muted:!item.muted}:item)}))}>{audio.muted?"🔇":"♪"}</button>
        <button className="timeline-clip-unlink" title="Unlink source audio" aria-label={"Unlink "+audio.name} onClick={()=>{try{change(p=>({...p,timelineClips:unlinkTimelineAudio({tracks:p.tracks,timelineClips:p.timelineClips??[]},audio.id).timelineClips}));setNotice("Audio unlinked and moved into the independent audio lane.");}catch(error){setNotice(error instanceof Error?error.message:"Unlink failed.");}}}>Unlink</button>
      </div>)}
    </div>
   </div>;
 })}
 </div>
 })}
 </div>

</section></div>
{activeTimelineTabId !== "master" && activeVersionTimelineTab && activeVersionTimeline && (activeVersionTimelineClipAsset || (activeVersionTimelineSlot && activeVersionTimelineShot)) && <section className="nested-timeline-tab">
  {renderTimelinePreview(
    activeVersionTimelineTab.id,
    activeVersionTimelineClipAsset ? "Clip Asset preview" : "Version preview",
    activeVersionTimelineClipAsset
      ? activeVersionTimelineClipAsset.name + " · " + activeVersionTimeline.name
      : activeVersionTimelineShot!.title + " · " + activeVersionTimeline.name,
    activeVersionTimeline.duration,
    activeVersionTimeline.name,
    activeVersionTimelineClipAsset ? "Reusable Clip Asset" : activeVersionTimelineShot!.intent
  )}
  <div className="editor-linked-heading">
    <div>
      <strong>{activeVersionTimelineClipAsset ? activeVersionTimelineClipAsset.name + " · " + activeVersionTimeline.name : activeVersionTimelineShot!.title + " · " + activeVersionTimeline.name}</strong>
      <span>{activeVersionTimelineClipAsset ? "Clip Asset timeline · edits affect this Clip Version only" : "Version timeline · edits here do not change the Master Shot duration"}</span>
    </div>
    <div className="inline-actions">
      {activeVersionTimelineClipAsset && <>
        <label className="nested-version-duration">Clip Version <span><select aria-label="Clip Asset version" className="text-field" value={activeVersionTimeline.id} onChange={event => chooseClipAssetVersion(activeVersionTimelineClipAsset.id, event.target.value)}>{(activeVersionTimelineClipAsset.clipVersions ?? []).map((version, index) => <option key={version.id} value={version.id}>{version.name || "Version " + (index + 1)}</option>)}</select></span></label>
        <button className="button button-quiet button-small" onClick={() => duplicateClipAssetVersion(activeVersionTimelineClipAsset.id, activeVersionTimeline.id)}><Plus size={13}/> Duplicate Version</button>
      </>}
      <button className="button button-quiet button-small" onClick={() => addTimelineVersionLayer(activeVersionTimelineTab, "video")}><Plus size={13}/> Video</button>
      <button className="button button-quiet button-small" onClick={() => addTimelineVersionLayer(activeVersionTimelineTab, "image")}><Plus size={13}/> Image</button>
      <button className="button button-quiet button-small" onClick={() => addTimelineVersionLayer(activeVersionTimelineTab, "audio")}><Plus size={13}/> Audio</button>
      <button className="button button-quiet button-small" onClick={() => addTimelineVersionLayer(activeVersionTimelineTab, "text")}><Plus size={13}/> Text</button>
      <button className="button button-quiet button-small" onClick={() => addTimelineVersionLayer(activeVersionTimelineTab, "procedural")}><Plus size={13}/> Code</button>
      <button className="button button-quiet button-small" onClick={() => addTimelineVersionLayer(activeVersionTimelineTab, "composition")}><Plus size={13}/> Clip</button>
      <label className="nested-version-duration">Duration <span><input aria-label="Version duration" type="number" min="0.1" step={1/Math.max(1,project.frameRate)} value={activeVersionTimeline.duration} onChange={event=>updateTimelineVersionDuration(activeVersionTimelineTab,Number(event.target.value))}/>s</span></label>
    </div>
  </div>
  <details className="nested-version-details">
    <summary>Version details</summary>
    <label className="field-label">Description
      <textarea className="text-area" rows={2} aria-label="Version description" value={activeVersionTimeline.description} onChange={event => updateTimelineVersionDescription(activeVersionTimelineTab, event.target.value)} />
    </label>
  </details>
  <div className="nested-timeline-ruler" aria-label="Version timeline ruler">
    {Array.from({length:Math.floor(activeVersionTimeline.duration/2)+1},(_,i)=>i*2).concat(activeVersionTimeline.duration%2===0?[]:[activeVersionTimeline.duration]).map(sec=><span key={sec} style={{left:(sec/Math.max(activeVersionTimeline.duration,0.1)*100)+"%"}}>{time(sec)}</span>)}
    <div className="nested-timeline-playhead" style={{left:(Math.min(editorTime,activeVersionTimeline.duration)/Math.max(activeVersionTimeline.duration,0.1)*100)+"%"}}/>
  </div>
  <div className="nested-timeline-lanes">
    {activeVersionTimeline.layers.map(layer=><div className="nested-timeline-row" key={layer.id}>
      <div className="nested-timeline-row-label"><span>{layer.kind==="procedural"?"◇":layer.kind==="audio"?"♫":layer.kind==="text"?"T":layer.kind==="image"?"▧":layer.kind==="composition"?"▧":layer.kind==="script"?"&lt;/&gt;":"▣"}</span><div><strong>{layer.name}</strong><small>{layer.kind==="procedural"?"Code":layer.kind==="composition"?"Clip":layer.kind}</small></div>
        <button className="layer-order-button" aria-label={"Move " + layer.name + " earlier"} title="Move layer earlier" disabled={activeVersionTimeline.layers.findIndex(item=>item.id===layer.id)===0} onClick={()=>moveTimelineVersionLayer(activeVersionTimelineTab,layer.id,-1)}>↑</button>
        <button className="layer-order-button" aria-label={"Move " + layer.name + " later"} title="Move layer later" disabled={activeVersionTimeline.layers.findIndex(item=>item.id===layer.id)===activeVersionTimeline.layers.length-1} onClick={()=>moveTimelineVersionLayer(activeVersionTimelineTab,layer.id,1)}>↓</button>
        {activeVersionTimelineClipAsset && <button className="layer-order-button" aria-label={"Settings for " + layer.name} title="Edit clip details" onClick={()=>setCompositionLayerSettingsId(layer.id)}><Settings2 size={12}/></button>}
        {layer.kind==="audio" && <button className="layer-mute-toggle" aria-pressed={Boolean(layer.muted)} onClick={()=>updateTimelineVersionLayer(activeVersionTimelineTab,layer.id,{muted:!layer.muted})}>{layer.muted?"Unmute":"Mute"}</button>}
        <button className="layer-remove" aria-label={"Delete " + layer.name} onClick={()=>removeTimelineVersionLayer(activeVersionTimelineTab,layer.id)}>×</button>
      </div>
      <div className="nested-timeline-row-track">
        <button draggable className={"nested-timeline-clip kind-" + layer.kind} style={{left:(layer.start/Math.max(activeVersionTimeline.duration,0.1)*100)+"%",width:Math.max(1.5,layer.duration/Math.max(activeVersionTimeline.duration,0.1)*100)+"%"}} onDragStart={event=>{event.dataTransfer.setData("text/dionysus-version-layer",layer.id);event.dataTransfer.effectAllowed="move";}} onDragEnd={event=>{const lane=event.currentTarget.parentElement;const rect=lane?.getBoundingClientRect();if(!rect)return;const fps=Math.max(1,project.frameRate||24);const pointer=((event.clientX-rect.left)/Math.max(rect.width,1))*activeVersionTimeline.duration;const maxStart=Math.max(0,activeVersionTimeline.duration-layer.duration);const rawStart=Math.max(0,Math.min(maxStart,pointer-layer.duration/2));const next=Math.round(rawStart*fps)/fps;updateTimelineVersionLayer(activeVersionTimelineTab,layer.id,{start:next});playbackTimeRef.current=next;setEditorTime(next);setIsPlaying(false);}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setNestedLayerContextMenuId(layer.id);setNestedLayerContextMenuPosition({x:Math.min(event.clientX,window.innerWidth-190),y:Math.min(event.clientY,window.innerHeight-180)});}} onClick={()=>{setSelectedCompositionLayerId(layer.id);setEditorTime(layer.start)}} onDoubleClick={()=>setCompositionLayerSettingsId(layer.id)} title={layer.name+" · "+layer.start.toFixed(1)+"–"+(layer.start+layer.duration).toFixed(1)+"s"}><strong>{layer.name}</strong><small>{layer.duration.toFixed(1)}s</small></button>
      </div>
    </div>)}
    {!activeVersionTimeline.layers.length && <div className="nested-timeline-empty">This timeline is empty. Add a video, image, audio, text, Code, or another Clip above.</div>}
    {activeVersionTimeline.layers.some(layer=>layer.start+layer.duration>activeVersionTimeline.duration) && <div className="nested-timeline-warning" role="status">One or more modules extend past this timeline's duration and may be cut off in preview/export. Their timing has not been changed automatically.</div>}
  </div>
</section>}
{selected && (() => { const activeSlot = selected.slots.find(slot => slot.id === selectedSlotId); if (!activeSlot) return null; const activeVersion = activeSlot.versions.find(version => version.id === (activeVersionTimelineTab?.slotId === activeSlot.id ? activeVersionTimelineTab.versionId : activeSlot.selectedVersionId)); return <details className={"version-panel-disclosure" + (activeTimelineTabId !== "master" ? " nested-version-inspector-disclosure" : "")} open={activeTimelineTabId === "master"}>{activeTimelineTabId !== "master" && <summary>Version &amp; module details</summary>}<section className={"version-panel " + (activeTimelineTabId !== "master" ? "nested-version-inspector" : "")}><div className="version-panel-heading"><div><span className="inspector-kicker">{activeTimelineTabId === "master" ? "CLIP SLOT" : "VERSION INSPECTOR"}</span><label className="field-label">Clip slot name<input className="text-field" aria-label="Clip slot name" value={activeSlot.name} onChange={e => updateSlotName(selected.id, activeSlot.id, e.target.value)} /></label><p>{activeSlot.duration}s · {activeSlot.versions.length} version{activeSlot.versions.length === 1 ? "" : "s"}</p></div><button className="button button-quiet button-small" onClick={() => setSelectedSlotId("")}>Close</button></div><div className="slot-timing-controls">
  <div className="timing-field"><label className="field-label">Start time (seconds)<input className="text-field" type="number" min="0" step="0.1" value={activeSlot.start} onChange={e => updateSlotTiming(selected.id, activeSlot.id, "start", Number(e.target.value))}/></label><div className="timing-nudges"><button type="button" aria-label="Move start earlier by 0.5 seconds" onClick={() => updateSlotTiming(selected.id, activeSlot.id, "start", activeSlot.start - 0.5)}>−0.5s</button><button type="button" aria-label="Move start later by 0.5 seconds" onClick={() => updateSlotTiming(selected.id, activeSlot.id, "start", activeSlot.start + 0.5)}>+0.5s</button></div></div>
  <div className="timing-field"><label className="field-label">Slot duration (seconds)<input className="text-field" type="number" min="0.1" step="0.1" value={activeSlot.duration} onChange={e => updateSlotTiming(selected.id, activeSlot.id, "duration", Number(e.target.value))}/></label><div className="timing-nudges"><button type="button" aria-label="Shorten slot by 0.5 seconds" onClick={() => updateSlotTiming(selected.id, activeSlot.id, "duration", activeSlot.duration - 0.5)}>−0.5s</button><button type="button" aria-label="Lengthen slot by 0.5 seconds" onClick={() => updateSlotTiming(selected.id, activeSlot.id, "duration", activeSlot.duration + 0.5)}>+0.5s</button></div></div>
  <p>Timeline position: {activeSlot.start.toFixed(1)}s–{(activeSlot.start + activeSlot.duration).toFixed(1)}s. Timing changes apply to this Clip Slot only.</p>
  {activeSlot.start + activeSlot.duration > selected.duration && <p className="timing-warning" role="status">This Clip Slot extends {((activeSlot.start + activeSlot.duration) - selected.duration).toFixed(1)}s beyond the selected shot duration ({selected.duration}s).</p>}
  {selected.slots.some(slot => slot.id !== activeSlot.id && activeSlot.start < slot.start + slot.duration && slot.start < activeSlot.start + activeSlot.duration) && <p className="timing-warning timing-warning-overlap" role="status">This Clip Slot overlaps another slot in the selected shot. Overlap is allowed, but should be reviewed.</p>}
</div><div className="version-list">{activeSlot.versions.map((version, index) => <button key={version.id} className={"version-card " + (version.id === activeSlot.selectedVersionId ? "active" : "")} onClick={() => chooseSlotVersion(selected.id, activeSlot.id, version.id)}><div className="version-thumb"><Film size={20}/><span>V{index + 1}</span></div><div className="version-card-copy"><strong>{version.name}</strong><p>{version.description || "No description yet."}</p><small>{version.duration}s · {version.layers.length} layers · {version.generationRecords.length} generations</small></div><span className="version-current">{version.id === activeSlot.selectedVersionId ? "CURRENT" : "SELECT"}</span></button>)}</div><button className="button button-primary" onClick={() => createSlotVersion(selected.id, activeSlot.id)}><Plus size={14}/> Create new version</button><p className="version-hint">A new version is created from the selected version's settings and layers. Existing versions remain unchanged.</p>{activeVersion && <div className="version-description"><label className="field-label">Selected version description</label><textarea className="text-area" value={activeVersion.description} onChange={e => change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== selected.id ? shot : { ...shot, slots: shot.slots.map(slot => slot.id !== activeSlot.id ? slot : { ...slot, versions: slot.versions.map(version => version.id === activeVersion.id ? { ...version, description: e.target.value } : version) }) }) }))} placeholder="Describe this version..." /></div>}
                {activeVersion && <section className="nested-module-editor">
                  <div className="inspector-subheading"><span>Shot submodules</span><span className="small-count">{activeVersion.layers.length}</span></div>
                  <p className="version-hint">This nested timeline belongs to the selected shot version. Changes here do not automatically extend the master shot.</p>
                  <div className="nested-module-lane">
                    {activeVersion.layers.map(layer => <article className="nested-module-card" key={layer.id}>
                      <div className="nested-module-title"><strong>{layer.name}</strong><span>{layer.kind}</span></div>
                      <div className="visual-provenance-grid nested-layer-timing">
                        <label>Module start (seconds)<input className="text-field" aria-label={"Version layer " + layer.id + " start"} type="number" min="0" step={1/Math.max(1,project.frameRate)} value={layer.start} onChange={event=>{const next=Math.max(0,Math.min(Number(event.target.value)||0,Math.max(0,activeVersion.duration-layer.duration)));updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{start:next});}}/></label>
                        <label>Module duration (seconds)<input className="text-field" aria-label={"Version layer " + layer.id + " duration"} type="number" min="0.1" step={1/Math.max(1,project.frameRate)} value={layer.duration} onChange={event=>{const next=Math.max(0.1,Math.min(Number(event.target.value)||0.1,Math.max(0.1,activeVersion.duration-layer.start)));const patch:Partial<CompositionLayer>={duration:next};if((layer.kind==="video"||layer.kind==="audio")&&layer.sourceOut!==undefined)patch.sourceOut=(layer.sourceIn??0)+next;updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,patch);}}/></label>
                      </div>
                      <div className="visual-provenance-grid"><label>Layer type<select className="text-field" aria-label={layer.name + " layer type"} value={layer.kind} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{kind:e.target.value as CompositionLayer["kind"],assetId:undefined})}><option value="video">Video</option><option value="image">Image</option><option value="audio">Audio</option><option value="text">Text</option><option value="composition">Composition placeholder</option><option value="script">Script</option><option value="procedural">Code / JavaScript</option></select></label>
                        <label>Source asset<select className="text-field" aria-label={layer.name + " source asset"} value={layer.assetId??""} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{assetId:e.target.value||undefined})}><option value="">No source assigned</option>{project.assets.filter(asset=>layer.kind==="video"?asset.kind==="video":layer.kind==="image"?asset.kind==="image":layer.kind==="audio"?asset.kind==="audio":layer.kind==="procedural"||layer.kind==="script"?asset.kind==="script":false).map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                      </div>{(layer.kind==="video"||layer.kind==="audio") && <div className="visual-provenance-grid nested-source-range">
                        <label>Source in (seconds)<input className="text-field" aria-label={"Version layer " + layer.id + " source in"} type="number" min="0" step={1/Math.max(1,project.frameRate)} value={layer.sourceIn??0} onChange={event=>{const sourceIn=Math.max(0,Number(event.target.value)||0);const sourceOut=Math.max(sourceIn+0.1,layer.sourceOut??(sourceIn+layer.duration));updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{sourceIn,sourceOut,duration:sourceOut-sourceIn});}}/></label>
                        <label>Source out (seconds)<input className="text-field" aria-label={"Version layer " + layer.id + " source out"} type="number" min={(layer.sourceIn??0)+0.1} step={1/Math.max(1,project.frameRate)} value={layer.sourceOut??((layer.sourceIn??0)+layer.duration)} onChange={event=>{const sourceIn=layer.sourceIn??0;const sourceOut=Math.max(sourceIn+0.1,Number(event.target.value)||sourceIn+0.1);updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{sourceOut,duration:sourceOut-sourceIn});}}/></label>
                      </div>}{layer.kind==="audio" && <div className="audio-mix-controls nested-audio-mix-controls">
                        <label>Volume <span>{Math.round((layer.volume??1)*100)}%</span><input aria-label={"Version layer " + layer.id + " volume"} className="audio-volume-slider" type="range" min="0" max="1" step="0.05" value={layer.volume??1} onChange={event=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{volume:Number(event.target.value)})}/></label>
                        <label>Fade In (s)<input className="text-field" aria-label={"Version layer " + layer.id + " fade in"} type="number" min="0" max={layer.duration} step={1/Math.max(1,project.frameRate)} value={layer.fadeIn??0} onChange={event=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{fadeIn:Math.max(0,Math.min(layer.duration,Number(event.target.value)||0))})}/></label>
                        <label>Fade Out (s)<input className="text-field" aria-label={"Version layer " + layer.id + " fade out"} type="number" min="0" max={layer.duration} step={1/Math.max(1,project.frameRate)} value={layer.fadeOut??0} onChange={event=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{fadeOut:Math.max(0,Math.min(layer.duration,Number(event.target.value)||0))})}/></label>
                      </div>}{layer.kind==="procedural" && <label className="field-label">Pinned script / scene version ID<input className="text-field" aria-label={layer.name + " script version ID"} value={layer.scriptVersionId ?? ""} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{scriptVersionId:e.target.value||undefined})} placeholder="Use a saved, authorized script version ID"/></label>}<div className="composition-frame-controls"><label>Fit mode<select className="text-field" aria-label={layer.name + " fit mode"} value={layer.fitMode ?? "contain"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{fitMode:e.target.value as CompositionLayer["fitMode"]})}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label><label>X (%)<input className="text-field" type="number" value={layer.x ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{x:Number(e.target.value)||0})}/></label><label>Y (%)<input className="text-field" type="number" value={layer.y ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{y:Number(e.target.value)||0})}/></label><label>Width (%)<input className="text-field" type="number" min="1" max="100" value={layer.width ?? 100} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{width:Math.max(1,Math.min(100,Number(e.target.value)||1))})}/></label><label>Height (%)<input className="text-field" type="number" min="1" max="100" value={layer.height ?? 100} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{height:Math.max(1,Math.min(100,Number(e.target.value)||1))})}/></label><label>Frame shape<select className="text-field" value={layer.shape ?? "rectangle"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{shape:e.target.value as CompositionLayer["shape"]})}><option value="rectangle">Rectangle</option><option value="rounded">Rounded</option><option value="circle">Circle</option></select></label><label>Background<input className="text-field" type="color" value={layer.backgroundColor ?? "#111113"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{backgroundColor:e.target.value})}/></label><label>Border color<input className="text-field" type="color" value={layer.borderColor ?? "#000000"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{borderColor:e.target.value})}/></label><label>Border width (px)<input className="text-field" type="number" min="0" value={layer.borderWidth ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{borderWidth:Math.max(0,Number(e.target.value)||0)})}/></label><label>Corner radius (px)<input className="text-field" type="number" min="0" value={layer.cornerRadius ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{cornerRadius:Math.max(0,Number(e.target.value)||0)})}/></label><label>Scale<input className="text-field" type="number" min="0.01" step="0.1" value={layer.scale ?? 1} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{scale:Math.max(0.01,Number(e.target.value)||0.01)})}/></label><label>Opacity<input className="text-field" type="number" min="0" max="1" step="0.05" value={layer.opacity ?? 1} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{opacity:Math.max(0,Math.min(1,Number(e.target.value)||0))})}/></label><label>Animation<select className="text-field" aria-label={layer.name + " animation"} value={layer.animation ?? "none"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{animation:e.target.value as CompositionLayer["animation"]})}><option value="none">None</option><option value="float">Float</option><option value="pulse">Pulse</option><option value="rotate">Rotate</option></select></label><label>Animation duration (s)<input className="text-field" type="number" min="0.1" max="60" step="0.1" value={layer.animationDuration ?? 3} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{animationDuration:Math.max(0.1,Math.min(60,Number(e.target.value)||3))})}/></label></div>
                      <div className="visual-provenance-grid">
                        <label>Start (s)<input className="text-field" type="number" min="0" step="0.1" value={layer.start} onChange={e=>{const value=Math.max(0,Number(e.target.value)||0);change(p=>({...p,shots:p.shots.map(shot=>shot.id!==selected.id?shot:{...shot,slots:shot.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:version.layers.map(item=>item.id!==layer.id?item:{...item,start:value})})})})}));}}/></label>
                        <label>Duration (s)<input className="text-field" type="number" min="0.1" step="0.1" value={layer.duration} onChange={e=>{const value=Math.max(0.1,Number(e.target.value)||0.1);change(p=>({...p,shots:p.shots.map(shot=>shot.id!==selected.id?shot:{...shot,slots:shot.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:version.layers.map(item=>item.id!==layer.id?item:{...item,duration:value})})})})}));}}/></label>
                        <label>Source in (s)<input className="text-field" type="number" min="0" step="0.1" value={layer.sourceIn??0} onChange={e=>{const value=Math.max(0,Number(e.target.value)||0);change(p=>({...p,shots:p.shots.map(shot=>shot.id!==selected.id?shot:{...shot,slots:shot.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:version.layers.map(item=>item.id!==layer.id?item:{...item,sourceIn:value,sourceOut:Math.max(value+0.1,item.sourceOut??value+item.duration)})})})})}));}}/></label>
                        <label>Source out (s)<input className="text-field" type="number" min={(layer.sourceIn??0)+0.1} step="0.1" value={layer.sourceOut??((layer.sourceIn??0)+layer.duration)} onChange={e=>{const value=Math.max((layer.sourceIn??0)+0.1,Number(e.target.value)||0.1);change(p=>({...p,shots:p.shots.map(shot=>shot.id!==selected.id?shot:{...shot,slots:shot.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:version.layers.map(item=>item.id!==layer.id?item:{...item,sourceOut:value,duration:value-(item.sourceIn??0)})})})})}));}}/></label>
                      </div>
                      <label className="visual-prompt-field">Prompt<textarea className="text-area" rows={2} value={layer.prompt??""} placeholder="Optional submodule prompt" onChange={e=>change(p=>({...p,shots:p.shots.map(shot=>shot.id!==selected.id?shot:{...shot,slots:shot.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:version.layers.map(item=>item.id!==layer.id?item:{...item,prompt:e.target.value})})})})}))}/></label>{layer.kind!=="audio"&&layer.kind!=="script"&&<AIGenerationPanel prompt={layer.prompt??""} defaultModel={layer.modelName} referenceImages={getGenerationReferencePaths(selected.id)} onGenerated={async (imageUrl,model,prompt)=>{
                        const assetId=id("asset");
                        const response=await fetch(imageUrl);
                        if(!response.ok) throw new Error("Generated image could not be retrieved from the provider response.");
                        const blob=await response.blob();
                        if(!blob.type.startsWith("image/")) throw new Error("Provider response was not an image.");
                        const [path,thumbnailPath]=await Promise.all([storeMediaAsset(assetId,blob),createImageThumbnail(blob)]);
                        const current=projectRef.current;
                        const shot=current.shots.find(item=>item.id===selected.id);
                        const references=shot?current.referenceProfiles.filter(profile=>shot.referenceProfileIds.includes(profile.id)).flatMap(profile=>profile.references).filter(reference=>!shot.referenceOverrides.some(override=>override.referenceId===reference.id&&override.action==="exclude")).map(reference=>{const override=shot.referenceOverrides.find(item=>item.referenceId===reference.id&&item.action==="replace");return override?.replacementAssetId?{...reference,assetId:override.replacementAssetId}:{...reference};}):[];
                        const record={id:id("generation"),createdAt:new Date().toISOString(),prompt,referenceSnapshot:references,modelName:model,outputAssetId:assetId};
                        change(p=>({...p,assets:[...p.assets,{id:assetId,name:layer.name+" generated",kind:"image",path,prompt,modelName:model,...(thumbnailPath?{thumbnailPath}:{})}],shots:p.shots.map(item=>item.id!==selected.id?item:{...item,slots:item.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:version.layers.map(item=>item.id!==layer.id?item:{...item,kind:"image",assetId,prompt,modelName:model}),generationRecords:[...version.generationRecords,record]})})})}));
                        setNotice("Generated image stored locally and attached; prompt/model/reference provenance recorded.");
                      }}/>}<div className="visual-provenance-grid"><label>Generation model<input className="text-field" value={layer.modelName??""} placeholder="e.g. provider/model" onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{modelName:e.target.value})}/></label><label>Model version<input className="text-field" value={layer.modelVersion??""} placeholder="Optional model version" onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{modelVersion:e.target.value})}/></label></div>
                      <button className="button button-quiet button-small" onClick={()=>change(p=>({...p,shots:p.shots.map(shot=>shot.id!==selected.id?shot:{...shot,slots:shot.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:version.layers.filter(item=>item.id!==layer.id)})})})}))}>Remove submodule</button>
                    </article>)}
                    {!activeVersion.layers.length && <p className="muted-inline">No submodules yet. Add a placeholder module to begin building this shot internally.</p>}
                  </div>
                  <div className="composition-preview" aria-label="Composition frame preview"><div className="composition-preview-canvas" style={{aspectRatio: project.width + "/" + project.height, background: activeVersion.layers.find(layer=>layer.backgroundColor)?.backgroundColor ?? "#111113"}}>{activeVersion.layers.filter(layer=>["video","image","text","composition"].includes(layer.kind)).map(layer=>{const asset=project.assets.find(item=>item.id===layer.assetId); return <div key={layer.id} className="composition-preview-layer" style={{left:(layer.x??0)+"%",top:(layer.y??0)+"%",width:(layer.width??100)+"%",height:(layer.height??100)+"%",background:layer.backgroundColor??"#24242b",border:`${layer.borderWidth??0}px solid ${layer.borderColor??"#000000"}`,borderRadius:layer.shape==="circle"?"50%":layer.shape==="rounded"?(layer.cornerRadius??12)+"px":"0",opacity:layer.opacity??1,transform:`scale(${layer.scale??1})`,transformOrigin:"center",animation:layer.animation&&layer.animation!=="none"?`dys-${layer.animation} ${layer.animationDuration??3}s ease-in-out infinite alternate`:undefined}}>{asset?.path?.startsWith("data:image/")?<img src={asset.path} alt={asset.name} style={{width:"100%",height:"100%",objectFit:layer.fitMode??"contain"}}/>:<span>{layer.name}{layer.prompt?" · prompt saved":""}</span>}</div>})}</div><small>Live composition frame preview · export renders selected shot versions to WebM.</small></div>
                  <div className="inline-actions"><button className="button button-primary button-small" onClick={()=>change(p=>({...p,shots:p.shots.map(shot=>shot.id!==selected.id?shot:{...shot,slots:shot.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:[...version.layers,{id:id("submodule"),name:"Submodule "+(version.layers.length+1),kind:"video" as const,start:0,duration:Math.max(0.1,version.duration)}]})})})}))}><Plus size={14}/> Add submodule</button><button className="button button-quiet button-small" onClick={()=>recordVersionGeneration(selected.id,activeSlot.id,activeVersion.id)}>Record generation source</button></div>
                </section>}
              </section></details>; })()}<div className="timeline-note"><CircleHelp size={15}/><span>{t("timeline.planningNote")}</span></div></>}
          {view === "assets" && <>
            <div className="section-toolbar">
              <div><h2>{t("assets.title")}</h2><p>{t("assets.description")}</p></div>
              <div className="layer-add-menu-wrap">
                <button className="button button-primary button-small" aria-haspopup="menu" aria-expanded={showAssetCreateMenu} onClick={() => setShowAssetCreateMenu(value => !value)}><Plus size={15}/> Create asset <ChevronDown size={13}/></button>
                <div className="layer-add-menu" role="menu" hidden={!showAssetCreateMenu}>
                  <button role="menuitem" onClick={() => { setShowAssetCreateMenu(false); setClipAssetEditorOpen(true); }}>Clip</button>
                  <button role="menuitem" onClick={() => { setShowAssetCreateMenu(false); setCodeAssetDraft({name:"New code asset",html:"<main>Build something here</main>",css:"body { font-family: system-ui; display: grid; place-items: center; min-height: 100vh; }",js:"console.log(\"Ready to create\");"}); setCodeAssetEditorOpen(true); }}>Code</button>
                  <button role="menuitem" onClick={() => chooseAssetUpload("audio")}>Audio · Upload file</button>
                  <button role="menuitem" onClick={() => chooseAssetUpload("image")}>Image · Upload file</button>
                </div>
              </div>
              <input ref={assetFileInput} type="file" accept={assetUploadKind==="audio"?"audio/*":assetUploadKind==="image"?"image/*":"image/*,audio/*"} hidden onChange={event => { importAssetFile(event.target.files?.[0]); event.currentTarget.value=""; setAssetUploadKind("all"); if (assetFileInput.current) assetFileInput.current.accept="image/*,audio/*"; }}/>
            </div>
            {project.assets.length === 0
              ? <div className="empty-state"><div className="empty-icon"><Film size={23}/></div><h3>{t("assets.emptyTitle")}</h3><p>{t("assets.emptyDescription")}</p></div>
              : <div className="asset-grid">{project.assets.map(asset => <article className="asset-card" key={asset.id}>
                  <div className="asset-card-head">{asset.kind==="script"?<Code2 size={19}/>:asset.kind==="audio"?<AudioLines size={19}/>:asset.kind==="clip"?<Layers3 size={19}/>:<Film size={19}/>}<button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeAsset(asset.id)}>×</button></div>
                  <input className="text-field asset-name-field" aria-label={t("asset.nameLabel")} value={asset.name} onChange={event => updateAsset(asset.id, { name: event.target.value })}/>
                  <span>{asset.kind==="clip"?"Clip":asset.kind==="script"?"Code":t(("media."+asset.kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</span>
                  {asset.kind==="clip" && <>
                    <small>{asset.canvasWidth??project.width} × {asset.canvasHeight??project.height} px · {asset.clipVersions?.length??0} version(s)</small>
                    <button className="button button-quiet button-small" disabled={!asset.clipVersions?.length} onClick={() => { const versionId = asset.selectedClipVersionId ?? asset.clipVersions?.[0]?.id; if (versionId) openClipAssetTimeline(asset.id, versionId); }}>Edit Timeline</button>
                  </>}
                  {asset.path && <small className="asset-path">{asset.path.startsWith("data:image/") ? "Image stored locally for preview" : asset.path}</small>}
                  <input className="text-field asset-notes-field" aria-label={t("asset.notesLabel")} value={asset.notes ?? ""} placeholder={t("asset.notesPlaceholder")} onChange={event => updateAsset(asset.id, { notes: event.target.value })}/>
                  <input className="text-field" aria-label="Asset generation prompt" value={asset.prompt??""} placeholder="Generation prompt" onChange={event=>updateAsset(asset.id,{prompt:event.target.value})}/>
                  <input className="text-field" aria-label="Asset generation model" value={asset.modelName??""} placeholder="Generation model" onChange={event=>updateAsset(asset.id,{modelName:event.target.value})}/>
                  <input className="text-field" aria-label="Asset model version" value={asset.modelVersion??""} placeholder="Model version" onChange={event=>updateAsset(asset.id,{modelVersion:event.target.value})}/>
                </article>)}</div>}
            <p className="inline-note"><CircleHelp size={13}/>Media files are stored in this browser. Export the project metadata separately; media bytes are not automatically synced across devices.</p>
          </>}
          {view === "references" && <><div className="section-toolbar"><div><h2>{t("references.title")}</h2><p>{t("references.description")}</p></div><button className="button button-primary button-small" onClick={() => setShowProfileForm(v => !v)}><Plus size={15}/> {t("references.actionNewProfile")}</button></div>{showProfileForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addReferenceProfile(); }}><label className="field-label">{t("profile.nameLabel")}<input className="text-field" value={profileDraftName} onChange={e => setProfileDraftName(e.target.value)} placeholder={t("profile.namePlaceholder")} required/></label><label className="field-label">{t("profile.typeLabel")}<select className="text-field" value={profileDraftType} onChange={e => setProfileDraftType(e.target.value as ReferenceProfile["entityType"])}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.createProfile")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowProfileForm(false)}>{t("action.cancel")}</button></div></form>}{project.referenceProfiles.length === 0 ? <div className="empty-state"><div className="empty-icon"><Sparkles size={23}/></div><h3>{t("references.emptyTitle")}</h3><p>{t("references.emptyDescription")}</p><div className="reference-example"><span className="ref-chip">{t("reference.identity")}</span><span className="ref-chip">{t("reference.face")}</span><span className="ref-chip">{t("reference.outfit")}</span><span className="ref-chip">{t("reference.lighting")}</span></div></div> : <div className="profile-list">{project.referenceProfiles.map(profile => <article className="profile-card profile-card-expanded" key={profile.id}><div className="profile-heading"><Sparkles size={18}/><input className="text-field profile-name-field" aria-label={t("profile.nameLabel")} value={profile.name} onChange={e => updateReferenceProfile(profile.id, { name: e.target.value })}/><select className="text-field profile-type-field" aria-label={t("profile.typeLabel")} value={profile.entityType} onChange={e => updateReferenceProfile(profile.id, { entityType: e.target.value as ReferenceProfile["entityType"] })}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeReferenceProfile(profile.id)}>×</button></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={() => createStoryboardFromReference(profile.id)}>Create storyboard draft from references</button></div><div className="profile-reference-list">{profile.references.length ? profile.references.map(reference => { const asset = project.assets.find(a => a.id === reference.assetId); return <div className="profile-reference-row" key={reference.id}><span className="profile-reference-name">{asset?.name ?? t("references.missingAsset")}</span><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={reference.role} onChange={e => updateProfileReferenceRole(profile.id, reference.id, e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.remove")} onClick={() => removeProfileReference(profile.id, reference.id)}>×</button></div>; }) : <p className="muted-inline">{t("references.noReferences")}</p>}</div><form className="profile-add-reference" onSubmit={e => { e.preventDefault(); addProfileReference(profile.id); }}><select className="text-field" aria-label={t("references.chooseAsset")} value={referenceAssetId} onChange={e => setReferenceAssetId(e.target.value)}><option value="">{t("references.chooseAsset")}</option>{project.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={referenceRole} onChange={e => setReferenceRole(e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button type="submit" className="button button-quiet button-small" disabled={project.assets.length===0}>{t("references.actionAddReference")}</button></form></article>)}</div>}</>}
        </section>
        <aside className="inspector"><div className="inspector-header"><div><span className="inspector-kicker">{t("inspector.title")}</span><h2>{selected ? t("inspector.shotDetails") : t("inspector.projectDetails")}</h2></div><Settings2 size={17}/></div>{selected ? <div className="inspector-content"><div className="inline-actions"><button className="button button-quiet button-small" disabled={!selected} title="Create an independent copy of this shot" onClick={() => selected && duplicateShot(selected.id)}>Duplicate shot</button><button className="button button-quiet button-small danger-action" disabled={project.shots.length <= 1} title={project.shots.length <= 1 ? "A project must keep at least one shot" : "Delete selected shot"} onClick={() => selected && removeShot(selected.id)}>Delete shot</button></div><label className="field-label">{t("inspector.shotTitle")}</label><input className="text-field" value={selected.title} onChange={e => updateShot(selected.id, { title: e.target.value })}/><label className="field-label">{t("inspector.storyIntent")}</label><textarea className="text-area" placeholder={t("inspector.intentPlaceholder")} value={selected.intent} onChange={e => updateShot(selected.id, { intent: e.target.value })} rows={4}/>{project.shots.some(other=>other.id!==selected.id&&getMasterShotStart(project.shots,selected.id)<getMasterShotStart(project.shots,other.id)+other.duration&&getMasterShotStart(project.shots,other.id)<getMasterShotStart(project.shots,selected.id)+selected.duration)&&<p className="timing-warning master-shot-overlap-warning" role="status">This Master Shot overlaps another Shot. Free placement permits intentional overlaps; enable Ripple Reorder and drop a Shot to pack the sequence without overlaps.</p>}<div className="field-row master-shot-position-row"><div><label className="field-label">Master start (seconds)</label><div className="number-field"><input aria-label="Master Shot start time" type="number" min="0" step="0.1" value={getMasterShotStart(project.shots, selected.id)} onChange={e=>updateMasterShotStart(selected.id, Number(e.target.value))}/><span>s</span></div></div></div><div className="field-row"><div><label className="field-label">{t("inspector.targetDuration")}</label><div className="number-field"><input type="number" min={1} max={600} value={selected.duration} onChange={e => updateShot(selected.id, { duration: Math.max(1, Number(e.target.value) || 1) })}/><span>{t("inspector.secondsShort")}</span></div></div><div><label className="field-label">{t("inspector.status")}</label><select className="text-field" value={selected.status} onChange={e => updateShot(selected.id, { status: e.target.value as Shot["status"] })}><option value="planned">{t("status.planned")}</option><option value="in-progress">{t("status.in-progress")}</option><option value="ready">{t("status.ready")}</option></select></div></div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.clipSlots")}</span><span className="small-count">{selected.slots.length}</span></div><div className="slot-inspector-list">{selected.slots.map(slot => <div className={"slot-inspector " + (selectedSlotId === slot.id ? "selected" : "")} key={slot.id}><div className="slot-icon"><SquarePlay size={16}/></div><button type="button" className="slot-copy slot-select-button" aria-pressed={selectedSlotId === slot.id} onClick={() => { selectClipSlot(slot.id); setEditorTime(Math.min(runtime, selectedStart + slot.start)); }}><strong>{slot.name}</strong><span>{t("slot.versionCount", { duration: slot.duration, count: slot.versions.length })}</span></button><button className="mini-menu" title="Duplicate clip slot" aria-label={"Duplicate clip slot " + slot.name} onClick={() => duplicateSlot(selected.id, slot.id)}>⧉</button><button className="mini-menu danger-action" disabled={selected.slots.length <= 1} title={selected.slots.length <= 1 ? "A shot must keep at least one clip slot" : "Delete clip slot"} onClick={() => removeSlot(selected.id, slot.id)}>×</button></div>)}</div><button className="add-slot-button" onClick={() => addSlot(selected.id)}><Plus size={14}/> {t("action.addClipSlot")}</button><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("shot.references")}</span><span className="small-count">{selected.referenceProfileIds.length}</span></div><div className="shot-reference-list">{project.referenceProfiles.length ? project.referenceProfiles.map(profile => <div className="shot-reference-profile" key={profile.id}><label className="shot-reference-option"><input type="checkbox" checked={selected.referenceProfileIds.includes(profile.id)} onChange={e => toggleShotReferenceProfile(selected.id, profile.id, e.target.checked)}/><span>{profile.name}<small>{t("profile.referencesCount", { count: profile.references.length })}</small></span></label>{selected.referenceProfileIds.includes(profile.id) && profile.references.map(reference => { const asset = project.assets.find(item => item.id === reference.assetId); const override = selected.referenceOverrides.find(item => item.referenceId === reference.id); const replacements = project.assets.filter(item => item.id !== reference.assetId); return <div className="shot-reference-override" key={reference.id}><span>{asset?.name ?? t("references.missingAsset")}<small>{t(("referenceRole."+reference.role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</small></span><select className="text-field override-action" aria-label={t("shot.referenceOverride")} value={override?.action ?? "inherit"} onChange={e => updateShotReferenceOverride(selected.id, reference.id, e.target.value as "inherit" | "exclude" | "replace")}><option value="inherit">{t("referenceOverride.inherit")}</option><option value="exclude">{t("referenceOverride.exclude")}</option><option value="replace" disabled={replacements.length === 0}>{t("referenceOverride.replace")}</option></select>{override?.action === "replace" && <select className="text-field override-asset" aria-label={t("referenceOverride.replacementAsset")} value={override.replacementAssetId ?? ""} onChange={e => updateShotReferenceOverride(selected.id, reference.id, "replace", e.target.value)}>{replacements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>; })}</div>) : <p className="muted-inline">{t("shot.noReferenceProfiles")}</p>}</div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.aiPlanning")}</span><Sparkles size={14}/></div><div className="ai-hint"><WandSparkles size={16}/><p>{t("inspector.aiHint")}</p></div></div> : <div className="empty-inspector">{t("inspector.empty")}</div>}</aside></div>
        <footer className="statusbar"><div><span className="status-check"><Check size={11}/></span><span>{notice}</span></div><div><span><FileJson size={13}/> {t("footer.projectSchema")}</span><span className="statusbar-separator">·</span><span><ShieldCheck size={13}/> {t("footer.localFirst")}</span><span className="statusbar-separator">·</span><span><WandSparkles size={13}/> <span className="future-label">{t("footer.aiReady")}</span></span></div></footer>
      </div>
    </main>

    {nestedLayerContextMenuId && view === "timeline" && <div className="shot-context-dismiss" onClick={()=>setNestedLayerContextMenuId("")}><span className="shot-context-menu" role="menu" style={{left:nestedLayerContextMenuPosition.x,top:nestedLayerContextMenuPosition.y}} onClick={event=>event.stopPropagation()}>
      <button role="menuitem" onClick={event=>{event.stopPropagation();setSelectedCompositionLayerId(nestedLayerContextMenuId);setCompositionLayerSettingsId(nestedLayerContextMenuId);setNestedLayerContextMenuId("");}}>Settings…</button>
      <button role="menuitem" className="danger-action" onClick={()=>{const tab=timelineTabs.find(item=>item.id===activeTimelineTabId);const layer=activeVersionTimeline?.layers.find(item=>item.id===nestedLayerContextMenuId);if(tab&&layer&&window.confirm("Remove layer “"+layer.name+"”?"))removeTimelineVersionLayer(tab,layer.id);setNestedLayerContextMenuId("");}}>Remove layer…</button>
    </span></div>}
    {compositionLayerSettingsId && activeVersionTimelineTab && activeVersionTimeline && activeVersionTimeline.layers.find(layer=>layer.id===compositionLayerSettingsId) && (()=>{const layer=activeVersionTimeline.layers.find(item=>item.id===compositionLayerSettingsId)!;const update=(patch:Partial<CompositionLayer>)=>updateTimelineVersionLayer(activeVersionTimelineTab,layer.id,patch);const assets=layer.kind==="composition" ? (activeVersionTimelineTab.assetId ? getAllowedChildClipAssets(project.assets,activeVersionTimelineTab.assetId) : project.assets.filter(asset=>asset.kind==="clip")) : project.assets.filter(asset=>layer.kind==="audio"?asset.kind==="audio":layer.kind==="video"?asset.kind==="video":layer.kind==="image"?asset.kind==="image":asset.kind==="script");return <div className="settings-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setCompositionLayerSettingsId("");}}><section className="settings-dialog clip-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="composition-layer-settings-title"><header><div><span className="inspector-kicker">VERSION LAYER SETTINGS</span><h2 id="composition-layer-settings-title">{layer.name}</h2></div><button className="button button-quiet button-small" onClick={()=>setCompositionLayerSettingsId("")}>Close</button></header>
      <label className="field-label">Layer name<input className="text-field" value={layer.name} onChange={event=>update({name:event.target.value})}/></label>
      <label className="field-label">Asset<select className="text-field" value={layer.assetId??""} onChange={event=>{const assetId=event.target.value||undefined;const asset=project.assets.find(item=>item.id===assetId);update({assetId,childCompositionId:asset?.kind==="clip"?asset.id:undefined,clipVersionId:asset?.kind==="clip"?(asset.selectedClipVersionId??asset.clipVersions?.[0]?.id):undefined});}}><option value="">Placeholder / no source</option>{assets.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
      <div className="settings-dialog-grid"><label className="field-label">Start (s)<input className="text-field" type="number" min="0" step={1/Math.max(1,project.frameRate)} value={layer.start} onChange={event=>update({start:Math.max(0,Number(event.target.value)||0)})}/></label><label className="field-label">Duration (s)<input className="text-field" type="number" min={1/Math.max(1,project.frameRate)} step={1/Math.max(1,project.frameRate)} value={layer.duration} onChange={event=>update({duration:Math.max(1/Math.max(1,project.frameRate),Number(event.target.value)||.1)})}/></label><label className="field-label">X (%)<input className="text-field" type="number" min="0" max="100" value={layer.x??0} onChange={event=>update({x:Math.max(0,Math.min(100,Number(event.target.value)||0))})}/></label><label className="field-label">Y (%)<input className="text-field" type="number" min="0" max="100" value={layer.y??0} onChange={event=>update({y:Math.max(0,Math.min(100,Number(event.target.value)||0))})}/></label><label className="field-label">Width (%)<input className="text-field" type="number" min="1" max="100" value={layer.width??100} onChange={event=>update({width:Math.max(1,Math.min(100,Number(event.target.value)||1))})}/></label><label className="field-label">Height (%)<input className="text-field" type="number" min="1" max="100" value={layer.height??100} onChange={event=>update({height:Math.max(1,Math.min(100,Number(event.target.value)||1))})}/></label><label className="field-label">Opacity <strong>{Math.round((layer.opacity??1)*100)}%</strong><input className="text-field" type="range" min="0" max="1" step=".05" value={layer.opacity??1} onChange={event=>update({opacity:Number(event.target.value)})}/></label></div>
      {layer.kind==="procedural"&&<CodePlayground title={layer.name} html={layer.html??""} css={layer.css??""} js={layer.code??""} onChange={patch=>update({...((patch.html!==undefined)?{html:patch.html}:{}),...((patch.css!==undefined)?{css:patch.css}:{}),...((patch.js!==undefined)?{code:patch.js}:{})})}/>}
      <label className="field-label">Prompt / notes<textarea className="text-area" rows={3} value={layer.prompt??""} onChange={event=>update({prompt:event.target.value})}/></label>
      <footer><button className="button button-quiet button-small danger-action" onClick={()=>{if(window.confirm("Remove layer “"+layer.name+"”?")){removeVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,layer.id);setCompositionLayerSettingsId("");}}}>Remove layer…</button><button className="button button-primary button-small" onClick={()=>setCompositionLayerSettingsId("")}>Done</button></footer>
    </section></div>;})()}
    {trackContextMenuId && view === "timeline" && <div className="shot-context-dismiss" onClick={()=>setTrackContextMenuId("")}><span className="shot-context-menu" role="menu" style={{left:trackContextMenuPosition.x,top:trackContextMenuPosition.y}} onClick={event=>event.stopPropagation()}>
      <button role="menuitem" onClick={()=>{const track=project.tracks.find(item=>item.id===trackContextMenuId);if(track?.kind==="video")setVideoTrackSettingsId(track.id);else if(track)setGenericTrackSettingsId(track.id);setTrackContextMenuId("");}}>Settings…</button>
      <button role="menuitem" onClick={()=>{const track=project.tracks.find(item=>item.id===trackContextMenuId);if(track){const kind=track.kind==="video"?"video":track.kind==="audio"?"audio":track.kind==="text"?"text":"procedural";const clipId=id("timeline-clip");change(p=>({...p,timelineClips:[...(p.timelineClips??[]),{id:clipId,name:(kind==="procedural"?"Code":kind==="text"?"Text":kind==="audio"?"Audio":"Video")+" clip",kind,trackId:track.id,start:editorTime,duration:Math.max(.5,Math.min(3,mediaTimelineDuration-editorTime||3))}]}));setSelectedTimelineClipId(clipId);setTimelineClipSettingsId(clipId);}setTrackContextMenuId("");}}>Add clip</button>
      <button role="menuitem" className="danger-action" onClick={()=>{const track=project.tracks.find(item=>item.id===trackContextMenuId);if(track&&window.confirm("Remove layer “"+track.name+"” and all clips on it?")){change(p=>({...p,tracks:p.tracks.filter(item=>item.id!==track.id),timelineClips:(p.timelineClips??[]).filter(clip=>clip.trackId!==track.id&&!(clip.linkedVideoClipId&&(p.timelineClips??[]).some(source=>source.id===clip.linkedVideoClipId&&source.trackId===track.id)))}));setSelectedTimelineClipId("");setTimelineClipSettingsId("");}setTrackContextMenuId("");}}>Remove layer…</button>
    </span></div>}
    {clipContextMenuId && view === "timeline" && <div className="shot-context-dismiss" onClick={()=>setClipContextMenuId("")}><span className="shot-context-menu" role="menu" style={{left:clipContextMenuPosition.x,top:clipContextMenuPosition.y}} onClick={event=>event.stopPropagation()}>
      <button role="menuitem" onClick={event=>{event.stopPropagation();setTimelineClipSettingsId(clipContextMenuId);setClipContextMenuId("");}}>Settings…</button>
      <button role="menuitem" onClick={()=>{const clip=project.timelineClips?.find(item=>item.id===clipContextMenuId);if(clip){const newId=id("timeline-clip");change(p=>({...p,timelineClips:duplicateTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,{newClipId:newId,start:clip.start+clip.duration}).timelineClips}));setSelectedTimelineClipId(newId);}setClipContextMenuId("");}}>Duplicate clip</button>
      <button role="menuitem" className="danger-action" onClick={()=>{const clip=project.timelineClips?.find(item=>item.id===clipContextMenuId);if(clip&&window.confirm("Delete clip “"+clip.name+"”?")){change(p=>({...p,timelineClips:deleteTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id).timelineClips}));setSelectedTimelineClipId("");}setClipContextMenuId("");}}>Delete clip…</button>
    </span></div>}
    {timelineClipSettingsId && project.timelineClips?.find(clip=>clip.id===timelineClipSettingsId) && (()=>{const clip=project.timelineClips!.find(item=>item.id===timelineClipSettingsId)!;const updateClip=(patch:Partial<TimelineClip>)=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id===clip.id?{...item,...patch}:item)}));const audioAssets=project.assets.filter(asset=>asset.kind==="audio");const videoAssets=project.assets.filter(asset=>asset.kind==="video"||asset.kind==="image");const clipAssets=project.assets.filter(asset=>asset.kind==="clip");const codeAssets=project.assets.filter(asset=>asset.kind==="script");const options=clip.kind==="audio"?audioAssets:clip.kind==="video"?videoAssets:clip.kind==="clip"?clipAssets:clip.kind==="procedural"?codeAssets:[];return <div className="settings-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setTimelineClipSettingsId("");}}><section className="settings-dialog clip-settings-dialog visual-clip-inspector" role="dialog" aria-modal="true" aria-labelledby="timeline-clip-settings-title"><header><div><span className="inspector-kicker">{clip.kind.toUpperCase()} CLIP SETTINGS</span><h2 id="timeline-clip-settings-title">{clip.name}</h2></div><button className="button button-quiet button-small" onClick={()=>setTimelineClipSettingsId("")}>Close</button></header>
      <label className="field-label">Clip name<input className="text-field" value={clip.name} onChange={event=>updateClip({name:event.target.value})}/></label><div className="visual-clip-actions">
      <button onClick={()=>{try{change(p=>({...p,timelineClips:moveTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,Math.max(0,clip.start-.5)).timelineClips}));}catch(error){setNotice(error instanceof Error?error.message:"Move failed.");}}}>−0.5s</button>
      <button onClick={()=>{try{change(p=>({...p,timelineClips:moveTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,clip.start+.5).timelineClips}));}catch(error){setNotice(error instanceof Error?error.message:"Move failed.");}}}>+0.5s</button>
      <button onClick={()=>{try{change(p=>({...p,timelineClips:trimTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,Math.max(.1,clip.duration-.5)).timelineClips}));}catch(error){setNotice(error instanceof Error?error.message:"Trim failed.");}}}>Trim −0.5s</button>
      <button onClick={()=>{const fps=Math.max(1,project.frameRate||24),frame=1/fps,splitAt=Math.round((clip.start+clip.duration/2)*fps)/fps;if(clip.duration<frame*2)return;const newClipId=id("timeline-clip");const linked=(project.timelineClips??[]).filter(item=>item.kind==="audio"&&item.linkedVideoClipId===clip.id);try{change(p=>({...p,timelineClips:splitTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,Math.min(clip.start+clip.duration-frame,Math.max(clip.start+frame,splitAt)),{newClipId,...(linked.length?{newLinkedAudioClipIds:linked.map(()=>id("timeline-audio"))}:{})}).timelineClips}));setSelectedTimelineClipId(newClipId);setTimelineClipSettingsId(newClipId);}catch(error){setNotice(error instanceof Error?error.message:"Split failed.");}}}>Split at midpoint</button>
      <button disabled={Math.round(editorTime*Math.max(1,project.frameRate||24))/Math.max(1,project.frameRate||24)<=clip.start||Math.round(editorTime*Math.max(1,project.frameRate||24))/Math.max(1,project.frameRate||24)>=clip.start+clip.duration} onClick={()=>{const fps=Math.max(1,project.frameRate||24),splitAt=Math.round(editorTime*fps)/fps;if(splitAt<=clip.start||splitAt>=clip.start+clip.duration)return;const newClipId=id("timeline-clip");const linked=(project.timelineClips??[]).filter(item=>item.kind==="audio"&&item.linkedVideoClipId===clip.id);try{change(p=>({...p,timelineClips:splitTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,splitAt,{newClipId,...(linked.length?{newLinkedAudioClipIds:linked.map(()=>id("timeline-audio"))}:{})}).timelineClips}));setSelectedTimelineClipId(newClipId);setTimelineClipSettingsId(newClipId);}catch(error){setNotice(error instanceof Error?error.message:"Split failed.");}}}>Split at playhead</button>

      <button onClick={()=>{const newClipId=id("timeline-clip");try{change(p=>({...p,timelineClips:duplicateTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,{newClipId,start:clip.start+clip.duration,...(clip.kind==="video"&&(p.timelineClips??[]).some(item=>item.kind==="audio"&&item.linkedVideoClipId===clip.id)?{newAudioClipId:id("timeline-audio")}:{})}).timelineClips}));setSelectedTimelineClipId(newClipId);setTimelineClipSettingsId(newClipId);}catch(error){setNotice(error instanceof Error?error.message:"Duplicate failed.");}}}>Duplicate clip</button>
      {clip.kind==="audio"&&clip.linkedVideoClipId&&<button onClick={()=>{try{change(p=>({...p,timelineClips:unlinkTimelineAudio({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id).timelineClips}));}catch(error){setNotice(error instanceof Error?error.message:"Unlink failed.");}}}>Unlink audio</button>}
    </div>
    
      <div className="settings-dialog-grid"><label className="field-label">Start (seconds)<input className="text-field" type="number" min="0" step={1/Math.max(1,project.frameRate)} value={clip.start} onChange={event=>{const value=Math.max(0,Number(event.target.value)||0);try{change(p=>({...p,timelineClips:moveTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,value).timelineClips}));}catch(error){setNotice(error instanceof Error?error.message:"Could not move clip.");}}}/></label><label className="field-label">Duration (seconds)<input className="text-field" type="number" min={1/Math.max(1,project.frameRate)} step={1/Math.max(1,project.frameRate)} value={clip.duration} onChange={event=>{const duration=Math.max(1/Math.max(1,project.frameRate),Number(event.target.value)||.1);try{change(p=>({...p,timelineClips:trimTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id,duration).timelineClips}));}catch(error){setNotice(error instanceof Error?error.message:"Could not resize clip.");}}}/></label></div>
      {clip.kind==="video"&&clip.assetId&&["video","image"].includes(project.assets.find(asset=>asset.id===clip.assetId)?.kind??"")&&<label className="field-label">Media fit<select className="text-field" value={clip.fitMode??"contain"} onChange={event=>updateClip({fitMode:event.target.value as "contain"|"cover"|"fill"})}><option value="contain">Contain · show full frame</option><option value="cover">Cover · fill frame, crop edges</option><option value="fill">Stretch · fill frame</option></select></label>}
      {clip.kind==="video"&&clip.assetId&&project.assets.find(asset=>asset.id===clip.assetId)?.kind==="video"&&<><div className="settings-dialog-grid"><label className="field-label">Source in (seconds)<input className="text-field" type="number" min="0" step="0.1" value={clip.sourceIn??0} onChange={event=>updateClip({sourceIn:Math.max(0,Number(event.target.value)||0)})}/></label><label className="field-label">Source out (seconds)<input className="text-field" type="number" min="0" step="0.1" placeholder="End of source" value={clip.sourceOut??""} onChange={event=>updateClip({sourceOut:event.target.value===""?undefined:Math.max((clip.sourceIn??0)+0.1,Number(event.target.value)||0)})}/></label></div><label className="field-label">If the source is shorter than this clip<select className="text-field" value={clip.shortSourceBehavior??"once"} onChange={event=>updateClip({shortSourceBehavior:event.target.value as "once"|"loop"})}><option value="once">Play once, then stop</option><option value="loop">Repeat source until clip ends</option></select></label><p className="settings-dialog-description">Use Source in/out to choose the portion of the asset used by this timeline clip.</p></>}
      {clip.kind==="clip"&&clip.assetId&&project.assets.find(asset=>asset.id===clip.assetId)?.kind==="clip"&&<label className="field-label">If the source clip is shorter than this timeline clip<select className="text-field" value={clip.shortSourceBehavior??"once"} onChange={event=>updateClip({shortSourceBehavior:event.target.value as "once"|"loop"})}><option value="once">Play once, then stop</option><option value="loop">Repeat source clip until the end</option></select></label>}
      {options.length>0&&<label className="field-label">{clip.kind==="audio"?"Audio asset":clip.kind==="procedural"?"Code asset":clip.kind==="clip"?"Clip asset":"Video asset"}<select className="text-field" value={clip.assetId??""} onChange={event=>{const asset=options.find(item=>item.id===event.target.value);updateClip({assetId:asset?.id,...(clip.kind==="procedural"?{html:asset?.html??"",css:asset?.css??"",code:asset?.js??""}:{}),...(clip.kind==="clip"?{duration:asset?.clipVersions?.find(version=>version.id===asset.selectedClipVersionId)?.duration??asset?.clipVersions?.[0]?.duration??clip.duration}:{})});}}><option value="">Placeholder / no source</option>{options.map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>}
      {clip.kind==="audio"&&<><label className="field-label settings-range-field">Volume <strong>{Math.round((clip.volume??1)*100)}%</strong><input aria-label="Timeline audio volume" type="range" min="0" max="1" step=".05" value={clip.volume??1} onChange={event=>updateClip({volume:Number(event.target.value)})}/></label><div className="settings-dialog-grid"><label className="field-label">Fade in (s)<input aria-label="Timeline audio fade in" className="text-field" type="number" min="0" max={clip.duration} step=".1" value={clip.fadeIn??0} onChange={event=>updateClip({fadeIn:Math.max(0,Number(event.target.value)||0)})}/></label><label className="field-label">Fade out (s)<input aria-label="Timeline audio fade out" className="text-field" type="number" min="0" max={clip.duration} step=".1" value={clip.fadeOut??0} onChange={event=>updateClip({fadeOut:Math.max(0,Number(event.target.value)||0)})}/></label></div></>}
      {clip.kind==="procedural"&&<CodePlayground title={clip.name} html={clip.html??""} css={clip.css??""} js={clip.code??""} onChange={patch=>updateClip({...((patch.html!==undefined)?{html:patch.html}:{}),...((patch.css!==undefined)?{css:patch.css}:{}),...((patch.js!==undefined)?{code:patch.js}:{})})}/>}
      <label className="field-label">Prompt / notes<textarea className="text-area" rows={3} value={clip.prompt??""} onChange={event=>updateClip({prompt:event.target.value})} placeholder="Optional source prompt or notes"/></label>
      <footer><button className="button button-quiet button-small danger-action" onClick={()=>{if(window.confirm("Delete clip “"+clip.name+"”?")){change(p=>({...p,timelineClips:deleteTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},clip.id).timelineClips}));setSelectedTimelineClipId("");setTimelineClipSettingsId("");}}}>Delete clip…</button><button className="button button-primary button-small" onClick={()=>setTimelineClipSettingsId("")}>Done</button></footer>
    </section></div>;})()}
    {shotContextMenuId && view === "timeline" && <div className="shot-context-dismiss" onClick={()=>setShotContextMenuId("")}><span className="shot-context-menu" role="menu" style={{left:shotContextMenuPosition.x,top:shotContextMenuPosition.y}} onClick={event=>event.stopPropagation()}><button role="menuitem" onClick={event=>{event.stopPropagation();setShotSettingsId(shotContextMenuId);setShotContextMenuId("");}}>Settings…</button><button role="menuitem" onClick={()=>{duplicateShot(shotContextMenuId);setShotContextMenuId("");}}>Duplicate shot</button><button role="menuitem" className="danger-action" disabled={project.shots.length<=1} onClick={()=>{removeShot(shotContextMenuId);setShotContextMenuId("");}}>Delete shot</button></span></div>}
    {shotSettingsId && project.shots.find(shot=>shot.id===shotSettingsId) && (()=>{const shot=project.shots.find(item=>item.id===shotSettingsId)!;return <div className="settings-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setShotSettingsId("");}}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="shot-settings-title"><header><div><span className="inspector-kicker">SHOT SETTINGS</span><h2 id="shot-settings-title">{shot.title}</h2></div><button className="button button-quiet button-small" onClick={()=>setShotSettingsId("")}>Close</button></header><label className="field-label">Shot title<input className="text-field" aria-label="Shot title" value={shot.title} onChange={event=>updateShot(shot.id,{title:event.target.value})}/></label><label className="field-label">Story intent<textarea className="text-area" rows={3} aria-label="Story intent" value={shot.intent} onChange={event=>updateShot(shot.id,{intent:event.target.value})}/></label><div className="settings-dialog-grid"><label className="field-label">Master start (seconds)<input className="text-field" type="number" min="0" step="0.1" value={getMasterShotStart(project.shots,shot.id)} onChange={event=>updateMasterShotStart(shot.id,Number(event.target.value))}/></label><label className="field-label">Duration (seconds)<input className="text-field" type="number" min="1" max="600" value={shot.duration} onChange={event=>updateShot(shot.id,{duration:Math.max(1,Number(event.target.value)||1)})}/></label><label className="field-label">Status<select className="text-field" value={shot.status} onChange={event=>updateShot(shot.id,{status:event.target.value as Shot["status"]})}><option value="planned">Planned</option><option value="in-progress">In progress</option><option value="ready">Ready</option></select></label></div><footer><button className="button button-quiet button-small" onClick={()=>{duplicateShot(shot.id);setShotSettingsId("");}}>Duplicate</button><button className="button button-quiet button-small danger-action" disabled={project.shots.length<=1} onClick={()=>{removeShot(shot.id);setShotSettingsId("");}}>Delete shot</button><button className="button button-primary button-small" onClick={()=>setShotSettingsId("")}>Done</button></footer></section></div>;})()}
    {genericTrackSettingsId && project.tracks.find(track=>track.id===genericTrackSettingsId) && (()=>{const track=project.tracks.find(item=>item.id===genericTrackSettingsId)!;const updateTrack=(patch:Partial<typeof track>)=>change(p=>({...p,tracks:p.tracks.map(item=>item.id===track.id?{...item,...patch}:item)}));return <div className="settings-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setGenericTrackSettingsId("");}}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="generic-layer-settings-title"><header><div><span className="inspector-kicker">LAYER SETTINGS</span><h2 id="generic-layer-settings-title">{track.name}</h2></div><button className="button button-quiet button-small" onClick={()=>setGenericTrackSettingsId("")}>Close</button></header><label className="field-label">Layer name<input className="text-field" value={track.name} onChange={event=>updateTrack({name:event.target.value})}/></label><div className="settings-dialog-grid"><label className="field-label">X (%)<input className="text-field" type="number" min="0" max="100" value={track.x??10} onChange={event=>updateTrack({x:Math.max(0,Math.min(100,Number(event.target.value)||0))})}/></label><label className="field-label">Y (%)<input className="text-field" type="number" min="0" max="100" value={track.y??10} onChange={event=>updateTrack({y:Math.max(0,Math.min(100,Number(event.target.value)||0))})}/></label><label className="field-label">Width (%)<input className="text-field" type="number" min="1" max="100" value={track.width??80} onChange={event=>updateTrack({width:Math.max(1,Math.min(100,Number(event.target.value)||1))})}/></label><label className="field-label">Height (%)<input className="text-field" type="number" min="1" max="100" value={track.height??80} onChange={event=>updateTrack({height:Math.max(1,Math.min(100,Number(event.target.value)||1))})}/></label></div>{track.kind==="audio"&&<label className="settings-check-row"><input type="checkbox" checked={Boolean(track.muted)} onChange={event=>updateTrack({muted:event.target.checked})}/> Mute entire audio layer</label>}<footer><button className="button button-primary button-small" onClick={()=>setGenericTrackSettingsId("")}>Done</button></footer></section></div>;})()}
    {videoTrackSettingsId && project.tracks.find(track=>track.id===videoTrackSettingsId) && (()=>{const track=project.tracks.find(item=>item.id===videoTrackSettingsId)!;const updateTrack=(patch:Partial<typeof track>)=>change(p=>({...p,tracks:p.tracks.map(item=>item.id===track.id?{...item,...patch}:item)}));return <div className="settings-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setVideoTrackSettingsId("");}}><section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="video-layer-settings-title"><header><div><span className="inspector-kicker">LAYER SETTINGS</span><h2 id="video-layer-settings-title">{track.name} · Video</h2></div><button className="button button-quiet button-small" onClick={()=>setVideoTrackSettingsId("")}>Close</button></header><p className="settings-dialog-description">These settings affect every Shot on this Video layer.</p><label className="field-label">Background color<div className="settings-color-row"><input aria-label="Video layer background color" type="color" value={track.backgroundColor??"#111113"} disabled={Boolean(track.backgroundTransparent)} onChange={event=>updateTrack({backgroundColor:event.target.value})}/><span>{track.backgroundTransparent?"Transparent":track.backgroundColor??"#111113"}</span></div></label><div className="settings-dialog-grid"><label className="field-label">X (%)<input className="text-field" type="number" min="0" max="100" value={track.x??10} onChange={event=>updateTrack({x:Math.max(0,Math.min(100,Number(event.target.value)||0))})}/></label><label className="field-label">Y (%)<input className="text-field" type="number" min="0" max="100" value={track.y??10} onChange={event=>updateTrack({y:Math.max(0,Math.min(100,Number(event.target.value)||0))})}/></label><label className="field-label">Width (%)<input className="text-field" type="number" min="1" max="100" value={track.width??80} onChange={event=>updateTrack({width:Math.max(1,Math.min(100,Number(event.target.value)||1))})}/></label><label className="field-label">Height (%)<input className="text-field" type="number" min="1" max="100" value={track.height??80} onChange={event=>updateTrack({height:Math.max(1,Math.min(100,Number(event.target.value)||1))})}/></label></div><label className="settings-check-row"><input type="checkbox" checked={Boolean(track.backgroundTransparent)} onChange={event=>updateTrack({backgroundTransparent:event.target.checked})}/> Transparent background</label><label className="field-label settings-range-field">Video layer opacity <strong>{Math.round((track.opacity??1)*100)}%</strong><input aria-label="Video layer opacity" type="range" min="0" max="1" step="0.05" value={track.opacity??1} onChange={event=>updateTrack({opacity:Number(event.target.value)})}/></label><footer><button className="button button-quiet button-small" onClick={()=>{updateTrack({backgroundColor:"#111113",backgroundTransparent:false,opacity:1});}}>Reset</button><button className="button button-primary button-small" onClick={()=>setVideoTrackSettingsId("")}>Done</button></footer></section></div>;})()}
    {assetPickerTrackId && project.tracks.find(track=>track.id===assetPickerTrackId) && (()=>{const track=project.tracks.find(item=>item.id===assetPickerTrackId)!;const isAudio=track.kind==="audio";const available=project.assets.filter(asset=>isAudio?asset.kind==="audio":asset.kind==="video"||asset.kind==="image"||asset.kind==="script"||asset.kind==="clip").filter(asset=>{const match=(asset.name+" "+(asset.notes??"")).toLowerCase().includes(assetPickerSearch.toLowerCase());const typeMatch=assetPickerFilter==="all"||(assetPickerFilter==="video"?(asset.kind==="video"||asset.kind==="image"||asset.kind==="clip"):assetPickerFilter==="code"?asset.kind==="script":asset.kind==="audio");return match&&typeMatch;}).sort((a,b)=>assetPickerSort==="name"?a.name.localeCompare(b.name):assetPickerSort==="created"?(b.createdAt??"").localeCompare(a.createdAt??""): (b.updatedAt??b.createdAt??"").localeCompare(a.updatedAt??a.createdAt??""));const choose=(asset:Asset)=>{const kind:TimelineClip["kind"]=isAudio?"audio":asset.kind==="script"?"procedural":asset.kind==="clip"?"clip":"video";const clipId=id("timeline-clip");const clipVersion=asset.kind==="clip"?(asset.clipVersions?.find(version=>version.id===asset.selectedClipVersionId)??asset.clipVersions?.[0]):undefined;const duration=clipVersion?.duration??Math.max(.5,Math.min(3,mediaTimelineDuration-editorTime||3));const clip:TimelineClip={id:clipId,name:asset.name,kind,trackId:track.id,start:Math.round(editorTime*Math.max(1,project.frameRate||24))/Math.max(1,project.frameRate||24),duration,assetId:asset.id,sourceIn:0,...(clipVersion?{clipVersionId:clipVersion.id}:{}),...(asset.html!==undefined?{html:asset.html}:{}),...(asset.css!==undefined?{css:asset.css}:{}),...(asset.js!==undefined?{code:asset.js}:{})};change(p=>({...p,timelineClips:[...(p.timelineClips??[]),clip]}));setSelectedTimelineClipId(clipId);setSelectedTimelineTrackId(track.id);setTimelineClipSettingsId(clipId);setAssetPickerTrackId("");};return <div className="settings-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setAssetPickerTrackId("");}}><section className="settings-dialog asset-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="asset-picker-title"><header><div><span className="inspector-kicker">TIMELINE</span><h2 id="asset-picker-title">Add {isAudio?"audio":"clip"} from Assets</h2><p className="settings-dialog-description">Choose a reusable asset. New uploads are saved to the library too.</p></div><button className="button button-quiet button-small" onClick={()=>setAssetPickerTrackId("")}>Close</button></header><div className="asset-picker-controls"><input className="text-field" aria-label="Search assets" placeholder="Search assets…" value={assetPickerSearch} onChange={event=>setAssetPickerSearch(event.target.value)}/><select className="text-field" aria-label="Sort assets" value={assetPickerSort} onChange={event=>setAssetPickerSort(event.target.value as "created"|"modified"|"name")}><option value="created">Date created</option><option value="modified">Last modified</option><option value="name">Name</option></select></div>{!isAudio&&<div className="asset-picker-filters"><button className={assetPickerFilter==="all"?"active":""} onClick={()=>setAssetPickerFilter("all")}>All assets</button><button className={assetPickerFilter==="video"?"active":""} onClick={()=>setAssetPickerFilter("video")}>Video / image</button><button className={assetPickerFilter==="code"?"active":""} onClick={()=>setAssetPickerFilter("code")}>Code</button></div>}<div className="asset-picker-grid">{available.map(asset=>{return <button type="button" className="asset-picker-card" key={asset.id} onClick={()=>choose(asset)}><AssetThumbnail asset={asset} assets={project.assets}/><strong>{asset.name}</strong><small>{asset.kind==="script"?"Code asset":asset.kind==="clip"?"Clip asset":asset.kind==="audio"?"Audio":asset.kind==="image"?"Image":"Video"}{asset.createdAt?" · "+new Date(asset.createdAt).toLocaleDateString():""}</small></button>;})}{available.length===0&&<div className="asset-picker-empty">No matching assets. Upload media or create a code asset.</div>}</div><footer className="asset-picker-footer"><label className="button button-quiet button-small"><Upload size={14}/> Upload {isAudio?"audio":"video"}<input type="file" accept={isAudio?"audio/*":"video/*,image/*"} hidden onChange={event=>{void uploadAssetForTimeline(event.target.files?.[0]);event.currentTarget.value="";}}/></label>{!isAudio&&<><button className="button button-quiet button-small" onClick={()=>setClipAssetEditorOpen(true)}><Plus size={14}/> Create clip</button><button className="button button-primary button-small" onClick={()=>{setCodeAssetDraft({name:"New code asset",html:"<main>Build something here</main>",css:"body { font-family: system-ui; display: grid; place-items: center; min-height: 100vh; }",js:"// Start coding here"});setCodeAssetEditorOpen(true);}}><Plus size={14}/> Create code</button></>}</footer></section></div>;})()}
    {clipAssetEditorOpen && <ClipAssetEditor onClose={() => setClipAssetEditorOpen(false)} onSave={({name,canvasWidth,canvasHeight,duration}) => { const now = new Date().toISOString(); const version = { id: id("clip-version"), name: "Version A", description: "", duration, layers: [] as CompositionLayer[], scriptVersionIds: [] as string[], generationRecords: [] as ClipVersion["generationRecords"] }; const asset: Asset = { id: id("asset"), name, kind: "clip", canvasWidth, canvasHeight, notes: "Empty reusable Clip; edit its composition in the Timeline Editor.", createdAt: now, updatedAt: now, selectedClipVersionId: version.id, clipVersions: [version] }; change(p => ({ ...p, assets: [...p.assets, asset] })); setClipAssetEditorOpen(false); setNotice("Empty Clip asset saved to Assets. Add content from its Timeline Editor."); }} />}
    {projectSettingsOpen && <div className="settings-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setProjectSettingsOpen(false);}}>
      <section className="settings-dialog project-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="project-settings-title">
        <header><div><span className="inspector-kicker">PROJECT SETTINGS</span><h2 id="project-settings-title">Canvas &amp; playback</h2><p className="settings-dialog-description">These settings define the output frame for Master and Clip Timelines.</p></div><button className="button button-quiet button-small" onClick={()=>setProjectSettingsOpen(false)}>Close</button></header>
        <label className="field-label">Aspect ratio
          <select className="text-field" aria-label="Project aspect ratio" value={projectSettingsAspect} onChange={event=>updateProjectSettingsAspect(event.target.value as typeof projectSettingsAspect)}>
            <option value="16:9">16:9 · Landscape</option><option value="9:16">9:16 · Portrait</option><option value="4:3">4:3 · Classic</option><option value="1:1">1:1 · Square</option><option value="21:9">21:9 · Ultrawide</option><option value="custom">Custom</option>
          </select>
        </label>
        <label className="field-label">Resolution preset
          <select className="text-field" aria-label="Project resolution preset" value={projectSettingsResolution} onChange={event=>updateProjectResolution(event.target.value)}>
            <option value="custom">Custom dimensions</option><option value="3840x2160">3840 × 2160 · 4K UHD</option><option value="2560x1440">2560 × 1440 · QHD</option><option value="1920x1080">1920 × 1080 · Full HD</option><option value="1280x720">1280 × 720 · HD</option><option value="1080x1920">1080 × 1920 · Full HD Portrait</option><option value="1080x1080">1080 × 1080 · Square</option>
          </select>
        </label>
        <div className="settings-dialog-grid">
          <label className="field-label">Width (pixels)<input className="text-field" aria-label="Project width pixels" type="number" min="1" max="16384" step="1" value={projectSettingsWidth} onChange={event=>{setProjectSettingsWidth(Number(event.target.value));setProjectSettingsResolution("custom");setProjectSettingsAspect("custom");}}/></label>
          <label className="field-label">Height (pixels)<input className="text-field" aria-label="Project height pixels" type="number" min="1" max="16384" step="1" value={projectSettingsHeight} onChange={event=>{setProjectSettingsHeight(Number(event.target.value));setProjectSettingsResolution("custom");setProjectSettingsAspect("custom");}}/></label>
        </div>
        <label className="field-label">Frame rate (FPS)
          <select className="text-field" aria-label="Project frame rate" value={projectSettingsFrameRate} onChange={event=>setProjectSettingsFrameRate(Number(event.target.value))}>
            {[23.976,24,25,29.97,30,48,50,59.94,60,120].map(fps=><option key={fps} value={fps}>{fps} FPS</option>)}
          </select>
        </label>
        <div className="settings-preview-spec"><strong>{projectSettingsWidth} × {projectSettingsHeight}</strong><span>{(projectSettingsWidth/Math.max(1,projectSettingsHeight)).toFixed(3)} aspect · {projectSettingsFrameRate} FPS</span></div>
        <footer><button className="button button-quiet button-small" onClick={()=>setProjectSettingsOpen(false)}>Cancel</button><button className="button button-primary button-small" onClick={saveProjectSettings}>Save settings</button></footer>
      </section>
    </div>}
    {codeAssetEditorOpen && <div className="settings-dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setCodeAssetEditorOpen(false);}}><section className="settings-dialog code-asset-dialog" role="dialog" aria-modal="true" aria-labelledby="code-asset-title"><header><div><span className="inspector-kicker">NEW CODE ASSET</span><h2 id="code-asset-title">HTML · CSS · JavaScript</h2></div><button className="button button-quiet button-small" onClick={()=>setCodeAssetEditorOpen(false)}>Close</button></header><label className="field-label">Asset name<input className="text-field" value={codeAssetDraft.name} onChange={event=>setCodeAssetDraft(draft=>({...draft,name:event.target.value}))}/></label><CodePlayground title={codeAssetDraft.name} html={codeAssetDraft.html} css={codeAssetDraft.css} js={codeAssetDraft.js} onChange={patch=>setCodeAssetDraft(draft=>({...draft,...patch}))}/><footer><button className="button button-quiet button-small" onClick={()=>setCodeAssetEditorOpen(false)}>Cancel</button><button className="button button-primary button-small" onClick={()=>{const name=codeAssetDraft.name.trim();if(!name){setNotice("Give the code asset a name first.");return;}const now=new Date().toISOString();const asset:Asset={id:id("asset"),name,kind:"script",html:codeAssetDraft.html,css:codeAssetDraft.css,js:codeAssetDraft.js,createdAt:now,updatedAt:now,notes:"HTML/CSS/JavaScript code asset"};change(p=>({...p,assets:[...p.assets,asset]}));setCodeAssetEditorOpen(false);setNotice("Code asset saved to Assets.");}}>Save to Assets</button></footer></section></div>}
    <AgentStoryboardModal
      project={project}
      isOpen={isAgentModalOpen}
      onClose={() => setIsAgentModalOpen(false)}
      onApplyProject={updated => {
        change(() => updated);
        setSelectedId(updated.shots[0]?.id ?? "");
        setNotice("Imported agent storyboard successfully! " + updated.shots.length + " shots in flow.");
      }}
      onExportPlan={exportPlan}
    />

    <ProductionChecklistDrawer
      project={project}
      isOpen={isChecklistOpen}
      onClose={() => setIsChecklistOpen(false)}
      onSelectShot={sId => {
        setSelectedId(sId);
        setIsChecklistOpen(false);
      }}
      onUpdateShotStatus={(sId, status) => updateShot(sId, { status })}
      onOpenTimeline={() => {
        setIsChecklistOpen(false);
        setView("timeline");
        setView("timeline");
      }}
    />
  </div>;
}
