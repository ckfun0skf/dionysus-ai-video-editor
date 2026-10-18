import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, CheckCircle2, ChevronDown, CircleHelp, Clapperboard, Clock3, Download, FileJson, Film, FolderOpen, Layers3, Maximize2, Plus, Save, Settings2, ShieldCheck, Sparkles, SquarePlay, Upload, WandSparkles, Undo2, Redo2 } from "lucide-react";
import { sampleProject } from "./sampleProject";
import type { Asset, AssetKind, CompositionLayer, DionysusProject, ReferenceProfile, ReferenceRole, Shot, TimelineClip } from "./types";
import { validateProject } from "./projectValidation";
import { t } from "./i18n";
import { addVideoClip, moveTimelineClip, trimTimelineClip, unlinkTimelineAudio, deleteTimelineClip } from "./timelineOperations";
import { recordProjectChange, undoProjectChange as undoHistory, redoProjectChange as redoHistory } from "./projectHistory";
import ProceduralAnimationPreview from "./ProceduralAnimationPreview";
import { collectCompositionLayers, renderCompositionFrame, exportCompositionWebM, downloadExport } from "./compositionRenderer";
import AIGenerationPanel from "./AIGenerationPanel";
import { deleteStoredMediaAsset, isStoredMediaPath, resolveMediaSource, storeMediaAsset } from "./mediaAssetStore";
import { createImageThumbnail, createVideoThumbnail, getAssetThumbnail } from "./mediaThumbnail";
import { getMasterShotIndexAtTime, getMasterShotStart, getMasterShotStarts, getMasterTimelineDuration, rippleReorderMasterShots, setMasterShotDuration, setMasterShotStart } from "./masterTimeline";
import StoryboardFlowCanvas from "./StoryboardFlowCanvas";
import AgentStoryboardModal from "./AgentStoryboardModal";
import ProductionChecklistDrawer from "./ProductionChecklistDrawer";
type View = "storyboard" | "timeline" | "assets" | "references";
type VersionTimelineTab = { id: string; shotId: string; slotId: string; versionId: string; label: string };
const STORAGE_KEY = "dionysus.project.v1";
const id = (prefix: string) => prefix + "-" + crypto.randomUUID();
const time = (s: number) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const copy = (p: DionysusProject) => JSON.parse(JSON.stringify(p)) as DionysusProject;

export default function App() {
  const [project, setProject] = useState<DionysusProject>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return copy(sampleProject);
      const parsed: unknown = JSON.parse(raw);
      return validateProject(parsed) ? parsed : copy(sampleProject);
    } catch { return copy(sampleProject); }
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
  const [view, setView] = useState<View>("storyboard");
  const [editorTime, setEditorTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackTimeRef = useRef(0);
  const previewImagesRef = useRef(new Map<string, HTMLImageElement>());
  const previewVideosRef = useRef(new Map<string, HTMLVideoElement>());
  const previewMediaReleasesRef = useRef(new Map<string, () => void>());
  const [previewAssetId, setPreviewAssetId] = useState("");
  const [showPreviewOverlay, setShowPreviewOverlay] = useState(false);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewRenderId = useRef(0);
  const previewImage = previewAssetId === "__none__" ? undefined : project.assets.find(asset => asset.id === previewAssetId && asset.kind === "image" && Boolean(asset.path)) ?? project.assets.find(asset => asset.kind === "image" && Boolean(asset.path));
  const editorTimeLabel = (seconds: number) => `${time(seconds)}.${String(Math.floor((seconds % 1) * 100)).padStart(2, "0")}`;
  const [selectedId, setSelectedId] = useState(project.shots[0]?.id ?? "");
  const [notice, setNotice] = useState(t("status.localOnlyNotice"));
  const fileInput = useRef<HTMLInputElement>(null);
  const assetFileInput = useRef<HTMLInputElement>(null);
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [assetDraftName, setAssetDraftName] = useState("");
  const [assetDraftKind, setAssetDraftKind] = useState<AssetKind>("video");
  const [assetDraftNotes, setAssetDraftNotes] = useState("");
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
  const selectedTimelineClip = (project.timelineClips ?? []).find(clip => clip.id === selectedTimelineClipId);
  const activeVersionTimelineTab = timelineTabs.find(tab => tab.id === activeTimelineTabId);
  const activeVersionTimelineShot = activeVersionTimelineTab ? project.shots.find(shot => shot.id === activeVersionTimelineTab.shotId) : undefined;
  const activeVersionTimelineSlot = activeVersionTimelineTab ? activeVersionTimelineShot?.slots.find(slot => slot.id === activeVersionTimelineTab.slotId) : undefined;
  const activeVersionTimeline = activeVersionTimelineTab ? activeVersionTimelineSlot?.versions.find(version => version.id === activeVersionTimelineTab.versionId) : undefined;
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
    const canvas = previewCanvasRef.current;
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
        await renderCompositionFrame(frame, project, layers, editorTime, { width: 1280, height: 720 }, previewImagesRef.current, previewVideosRef.current, releases);
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
  }, [project, editorTime, previewImage, runtime, view, activeVersionTimeline]);
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
    const clips = activeVersionTimeline
      ? activeVersionTimeline.layers.filter(layer => layer.kind === "audio" && Boolean(layer.assetId)).map(layer => ({ id: layer.id, name: layer.name, kind: "audio" as const, assetId: layer.assetId, start: layer.start, duration: layer.duration, sourceIn: layer.sourceIn, sourceOut: layer.sourceOut, muted: layer.muted, linkedVideoClipId: undefined }))
      : (project.timelineClips ?? []).filter(clip => clip.kind === "audio" && Boolean(clip.assetId)).map(clip => ({
        ...clip,
        muted: Boolean(clip.muted || project.tracks.find(track => track.id === clip.trackId)?.muted)
      }));
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
          if (media.paused) void media.play().catch(() => { if (!cancelled && !warned) { warned = true; setNotice("Audio playback was blocked by the browser. Press Play again to retry."); } });
        } else if (!media.paused) media.pause();
      }
      frame = requestAnimationFrame(sync);
    };
    void prepare().then(() => { if (!cancelled) frame = requestAnimationFrame(sync); });
    return () => { cancelled = true; cancelAnimationFrame(frame); players.forEach(player => { player.element.pause(); player.element.removeAttribute("src"); player.release?.(); }); players.clear(); };
  }, [isPlaying, project, activeVersionTimeline]);

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
    change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== shotId ? shot : { ...shot, slots: shot.slots.map(slot => slot.id !== slotId ? slot : { ...slot, versions: slot.versions.map(version => version.id !== versionId ? version : { ...version, layers: version.layers.map(layer => layer.id !== layerId ? layer : { ...layer, ...patch }) }) }) }) }));
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
    setTimelineTabs(existing => existing.some(tab => tab.id === tabId) ? existing : [...existing, { id: tabId, shotId, slotId, versionId, label: shot.title + " · " + version.name }]);
    setActiveTimelineTabId(tabId);
    setSelectedId(shotId);
    setSelectedSlotId(slotId);
    setEditorTime(0);
    playbackTimeRef.current = 0;
    setSelectedTimelineClipId("");
    setIsPlaying(false);
    setView("timeline");
  }

  function closeTimelineTab(tabId: string) {
    setTimelineTabs(existing => existing.filter(tab => tab.id !== tabId));
    if (activeTimelineTabId === tabId) {
      setActiveTimelineTabId("master");
      setEditorTime(0);
      playbackTimeRef.current = 0;
      setIsPlaying(false);
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
      name: kind === "procedural" ? "Three.js module" : kind === "text" ? "Text layer" : kind === "audio" ? "Audio layer" : kind === "image" ? "Image layer" : kind === "composition" ? "Nested composition" : "Video layer",
      kind,
      start,
      duration: Math.max(0.1, Math.min(3, version.duration - start))
    };
    change(p => ({ ...p, shots: p.shots.map(item => item.id !== shotId ? item : { ...item, slots: item.slots.map(s => s.id !== slotId ? s : { ...s, versions: s.versions.map(v => v.id !== versionId ? v : { ...v, layers: [...v.layers, layer] }) }) }) }));
    setNotice(kind === "procedural" ? "Three.js layer added as a procedural module. Assign/authorize a script before expecting rendered output." : "Layer added to the selected Version.");
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

  function addMasterLayerClip(kind: "text" | "procedural") {
    const track = project.tracks.find(item => item.kind === kind);
    const trackId = track?.id ?? id("track-" + kind);
    const newTrack = track ?? { id: trackId, name: kind === "text" ? "Titles" : "Three.js", kind };
    const start = Math.max(0, Math.min(editorTime, Math.max(0, mediaTimelineDuration - 0.1)));
    const clip: TimelineClip = {
      id: id("timeline-" + kind),
      name: kind === "text" ? "Subtitle Block" : "Three.js Module",
      kind, trackId, start,
      duration: Math.max(0.1, Math.min(3, mediaTimelineDuration - start))
    };
    change(p => ({
      ...p,
      tracks: p.tracks.some(item => item.id === trackId) ? p.tracks : [...p.tracks, newTrack],
      timelineClips: [...(p.timelineClips ?? []), clip]
    }));
    setSelectedTimelineClipId(clip.id);
    setIsPlaying(false);
    setNotice(kind === "text"
      ? "Text block added. Edit its displayed text in the clip Inspector."
      : "Three.js module block added. Assign a script asset and pinned script-version ID; procedural output is not rendered by the current compositor.");
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
    const asset: Asset = { id: id("asset"), name: cleanName, kind, notes: notes.trim(), ...(path ? { path } : {}), ...(thumbnailPath ? { thumbnailPath } : {}) };
    change(p => ({ ...p, assets: [...p.assets, asset] }));
    setAssetDraftName(""); setAssetDraftNotes(""); setShowAssetForm(false);
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
    change(p => ({ ...p, assets: p.assets.map(a => a.id === assetId ? { ...a, ...patch } : a) }));
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
      setProject(data); setUndoStack([]); setRedoStack([]); lastHistoryGroup.current = ""; setSelectedId(data.shots[0]?.id ?? ""); setNotice(t("notice.projectImported"));
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
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> {t("heading.eyebrow")}</div><h1>{view === "storyboard" ? t("heading.storyboard.title") : view === "timeline" ? t("heading.timeline.title") : view === "assets" ? t("heading.assets.title") : t("heading.references.title")}</h1><p>{view === "storyboard" ? t("heading.storyboard.description") : view === "timeline" ? t("heading.timeline.description") : view === "assets" ? t("heading.assets.description") : t("heading.references.description")}</p></div><div className="heading-meta"><span className="status-dot"/> {t("status.autosaved")} <span className="meta-divider"/> <span>{t("project.versionFoundation")}</span></div></section>
        <section className="project-overview"><div className="overview-main"><div className="overview-icon"><Clapperboard size={19}/></div><div className="overview-copy"><div className="overview-kicker">{t("project.current")}</div><input className="project-name-input" aria-label={t("project.name")} value={project.name} onChange={e => change(p => ({ ...p, name: e.target.value }))}/><div className="project-subline"><span><Clock3 size={13}/> {t("project.runtimeSummary", { duration: time(runtime) })}</span><span><Film size={13}/> {t("project.shotCount", { count: project.shots.length })}</span><span><Layers3 size={13}/> {t("project.clipSlotCount", { count: slotCount })}</span></div></div></div><div className="project-specs"><div><span>{t("project.canvas")}</span><strong>{project.width} × {project.height}</strong></div><div><span>{t("project.frameRate")}</span><strong>{project.frameRate} FPS</strong></div><button className="icon-button" title={t("project.canvasSettingsPlanned")} onClick={() => setNotice(t("notice.canvasSettingsUnavailable"))}><Settings2 size={17}/></button></div></section>
        <div className="workbench"><section className="workbench-main">
          {view === "storyboard" && <><div className="section-toolbar"><div><h2>{t("storyboard.title")}</h2><p>{t("storyboard.shotCount", { count: project.shots.length })} · SeeDance node flow canvas</p></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={()=>setIsAgentModalOpen(true)}><Sparkles size={14} color="#d5f36a"/> AI Storyboard Plan</button><button className="button button-quiet button-small" onClick={()=>setIsChecklistOpen(true)}><CheckCircle2 size={14} color="#75d7c1"/> Production Guide</button><button className="button button-quiet button-small" onClick={()=>setStoryboardMode(m => m === "flow" ? "list" : "flow")}>{storyboardMode === "flow" ? <Layers3 size={14}/> : <Maximize2 size={14}/>} {storyboardMode === "flow" ? "Grid Cards" : "Node Flow Canvas"}</button><button className="button button-quiet button-small" onClick={syncStoryboardToTimeline}><Film size={14}/> Generate / update timeline</button><button className="button button-primary button-small" onClick={addShot}><Plus size={15}/> {t("action.addShot")}</button></div></div>{storyboardMode === "flow" ? <StoryboardFlowCanvas project={project} selectedShotId={selectedId} onSelectShot={setSelectedId} onUpdateShot={updateShot} onAddShot={addShot} onDeleteShot={removeShot} onDuplicateShot={duplicateShot} onAddConnection={addStoryboardConnection} onRemoveConnection={removeStoryboardConnection} onOpenAgentModal={()=>setIsAgentModalOpen(true)} onOpenChecklist={()=>setIsChecklistOpen(true)} onSyncTimeline={syncStoryboardToTimeline} onAttachAssetToShot={attachAssetToShot} onSelectVersion={(sId, slotId, vId) => { chooseSlotVersion(sId, slotId, vId); setSelectedSlotId(slotId); setView("timeline"); }}/> : <div className="shot-list">{project.shots.map((shot, i) => <article key={shot.id} role="button" tabIndex={0} className={"shot-card " + (selected?.id === shot.id ? "selected" : "")} onClick={() => setSelectedId(shot.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(shot.id); } }}><div className="shot-number">{String(i + 1).padStart(2, "0")}</div><div className="shot-thumb"><div className="thumb-grid"/><div className="thumb-center"><Film size={21}/></div><span>{time(shot.duration)}</span></div><div className="shot-card-body"><div className="shot-title-row"><h3>{shot.title}</h3><span className={"shot-status status-" + shot.status}>{t(("status." + shot.status) as "status.planned" | "status.in-progress" | "status.ready")}</span></div><p>{shot.intent || t("shot.emptyIntent")}</p><div className="shot-card-meta"><span><Layers3 size={13}/> {t("shot.clipSlotCount", { count: shot.slots.length })}</span><span><Clock3 size={13}/> {t("shot.durationTarget", { duration: shot.duration })}</span></div></div><div className="shot-arrow">↗</div><button type="button" className="shot-version-toggle" aria-expanded={expandedVersionShotId === shot.id} onClick={e => { e.stopPropagation(); setExpandedVersionShotId(expandedVersionShotId === shot.id ? "" : shot.id); }}><ChevronDown size={13}/><span>{shot.slots.reduce((n, slot) => n + slot.versions.length, 0)} versions</span></button>{expandedVersionShotId === shot.id && <div className="shot-version-dropdown" onClick={e => e.stopPropagation()}>{shot.slots.flatMap(slot => slot.versions.map((version, vi) => ({slot, version, vi}))).map(({slot,version,vi}) => <button type="button" key={version.id} className={"shot-version-option" + (version.id === slot.selectedVersionId ? " active" : "")} onClick={() => { setSelectedId(shot.id); setSelectedSlotId(slot.id); chooseSlotVersion(shot.id,slot.id,version.id); setView("timeline"); }}><span>{slot.name} · {version.name || "Version " + (vi+1)}</span><small>{version.duration}s · {version.layers.length} layers</small></button>)}</div>}</article>)}<button className="add-shot-card" onClick={addShot}><span><Plus size={17}/></span><strong>{t("shot.addAnother")}</strong><small>{t("shot.addAnotherHint")}</small></button></div>}</>}
          {view === "timeline" && <><section className="integrated-preview-panel" aria-label="Timeline preview"><div className="integrated-preview-heading"><div><span className="inspector-kicker">LIVE PREVIEW</span><strong>{activeVersionTimeline ? activeVersionTimelineShot?.title + " · " + activeVersionTimeline.name : activeShotInfo.shot?.title ?? project.name}</strong><small>{activeVersionTimeline ? "Version-internal preview. Master Shot duration remains unchanged." : activeShotInfo.shot?.intent || "Preview follows the master timeline playhead."}</small></div><span className="integrated-timecode">{editorTimeLabel(editorTime)} / {editorTimeLabel(activeTimelineDuration)}</span></div><div className="integrated-preview-frame"><canvas ref={previewCanvasRef} className="editor-preview-canvas" aria-label={"Timeline preview at " + editorTimeLabel(editorTime)} />{showPreviewOverlay && <div className="integrated-preview-overlay"><span>SHOT {String((activeShotInfo.index ?? 0)+1).padStart(2,"0")}</span><strong>{activeShotInfo.shot?.title ?? project.name}</strong><small>{activeShotInfo.shot?.intent || "No shot description"}</small></div>}</div><div className="integrated-preview-controls"><button className="button button-quiet button-small" onClick={()=>{setIsPlaying(false);setEditorTime(0);}} title="Go to start">|◀</button><button className="button button-primary button-small" aria-label={isPlaying ? "Pause preview" : "Play preview"} onClick={()=>{if(!isPlaying&&editorTime>=activeTimelineDuration){playbackTimeRef.current=0;setEditorTime(0);}setIsPlaying(value=>!value);}}>{isPlaying?"Pause":"Play"}</button><button className="button button-quiet button-small" onClick={()=>{setIsPlaying(false);setEditorTime(Math.min(activeTimelineDuration,editorTime+0.5));}}>+0.5s</button><label>Playhead <input aria-label="Timeline playhead time" type="range" min="0" max={Math.max(activeTimelineDuration,0.1)} step="0.05" value={Math.min(editorTime,activeTimelineDuration)} onChange={e=>{setIsPlaying(false);setEditorTime(Number(e.target.value));}} /></label><button className="button button-quiet button-small" aria-pressed={showPreviewOverlay} onClick={()=>setShowPreviewOverlay(value=>!value)}>{showPreviewOverlay ? "Hide overlay" : "Show overlay"}</button>{previewImage && <button className="button button-quiet button-small" onClick={()=>setPreviewAssetId("__none__")}>Clear preview image</button>}</div></section>
<div className="timeline-workspace-tabs" role="tablist" aria-label="Timeline tabs">
  <button role="tab" aria-selected={activeTimelineTabId === "master"} className={activeTimelineTabId === "master" ? "active" : ""} onClick={() => { setActiveTimelineTabId("master"); setEditorTime(0); playbackTimeRef.current=0; setIsPlaying(false); }}>Master Timeline</button>
  {timelineTabs.map(tab => <div className={"timeline-workspace-tab " + (activeTimelineTabId === tab.id ? "active" : "")} key={tab.id}>
    <button role="tab" aria-selected={activeTimelineTabId === tab.id} onClick={() => { setActiveTimelineTabId(tab.id); setSelectedId(tab.shotId); setSelectedSlotId(tab.slotId); setEditorTime(0); playbackTimeRef.current=0; setIsPlaying(false); }}>{tab.label}</button>
    <button className="timeline-tab-close" aria-label={"Close " + tab.label} onClick={() => closeTimelineTab(tab.id)}>×</button>
  </div>)}
</div>
<div className="timeline-tab-content master-timeline-content" style={{display:activeTimelineTabId === "master" ? "block" : "none"}}><div className="section-toolbar"><div><h2>{t("timeline.title")}</h2><p>{t("timeline.description")}</p></div><button className="button button-primary button-small" disabled={!selected} onClick={() => selected && addSlot(selected.id)}><Plus size={15}/> {t("action.addClipSlot")}</button></div><div className="timeline-ruler" role="slider" aria-label="Master timeline playhead" aria-valuemin={0} aria-valuemax={runtime} aria-valuenow={editorTime} tabIndex={0}
            onPointerDown={event => { const rect = event.currentTarget.getBoundingClientRect(); const next = Math.max(0, Math.min(runtime, ((event.clientX - rect.left) / Math.max(rect.width, 1)) * runtime)); playbackTimeRef.current = next; setIsPlaying(false); setEditorTime(next); }}
            onPointerMove={event => { if (event.buttons !== 1) return; const rect = event.currentTarget.getBoundingClientRect(); const next = Math.max(0, Math.min(runtime, ((event.clientX - rect.left) / Math.max(rect.width, 1)) * runtime)); playbackTimeRef.current = next; setIsPlaying(false); setEditorTime(next); }}
            onKeyDown={event => { if (event.key === "ArrowRight") { const next = Math.min(runtime, editorTime + 0.5); playbackTimeRef.current = next; setIsPlaying(false); setEditorTime(next); } if (event.key === "ArrowLeft") { const next = Math.max(0, editorTime - 0.5); playbackTimeRef.current = next; setIsPlaying(false); setEditorTime(next); } }}>
            <div className="integrated-ruler-playhead" style={{ left: (editorTime / Math.max(runtime, 1) * 100) + "%" }}/>
            {Array.from({ length: Math.floor(runtime / 5) + 1 }, (_, i) => i * 5).concat(runtime % 5 === 0 ? [] : [runtime]).map(seconds => <span key={seconds} style={{ left: (seconds / Math.max(runtime, 1) * 100) + "%" }}>{time(seconds)}</span>)}
          </div><div className="timeline-scroll">{project.tracks.map((track, i) => <div className="timeline-track" key={track.id}><div className="track-label">{track.kind === "audio" ? <AudioLines size={14}/> : track.kind === "text" ? <Sparkles size={14}/> : <Film size={14}/>}<span>{t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects")}</span></div><div className="track-lane" style={{ backgroundSize: (5 / Math.max(runtime, 1) * 100) + "% 100%" }}>{i === 0 && project.shots.map((shot, si) => <button key={shot.id} className={"timeline-shot " + (selected?.id === shot.id ? "chosen" : "")} style={{ left: (getMasterShotStarts(project.shots)[si] / Math.max(runtime, 1) * 100) + "%", width: (shot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => setSelectedId(shot.id)}><span>{shot.title}</span><small>{shot.duration}s</small></button>)}{i === 1 && selected?.slots.map(slot => <button key={slot.id} className="timeline-slot" style={{ left: ((selectedStart + slot.start) / Math.max(runtime, 1) * 100) + "%", width: (slot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => selectClipSlot(slot.id)}><span>{slot.name}</span><small>{slot.versions.find(v => v.id === slot.selectedVersionId)?.name ?? "No version"}</small></button>)}{i > 1 && <div className="track-empty"><span>+</span> {t("timeline.trackAddLayer", { kind: t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects") })}</div>}</div></div>)}</div><section className="editor-linked-timeline visual-timeline" aria-label="Media timeline">
<div className="editor-linked-heading"><div><strong>Timeline layers</strong><span>{(project.timelineClips ?? []).length} clips · drag blocks to move · select a block to edit</span></div><div className="inline-actions">
<button className="button button-quiet button-small" onClick={() => {
 const videoTrack=project.tracks.find(track=>track.kind==="video"), audioTrack=project.tracks.find(track=>track.kind==="audio");
 if(!videoTrack||!audioTrack){setNotice("Add a video track and an audio track first.");return;}
 const clipId=id("timeline-video");
 try{change(p=>{const result=addVideoClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},{id:clipId,name:"Video clip "+((p.timelineClips??[]).filter(clip=>clip.kind==="video"&&!clip.id.startsWith("storyboard-")).length+1),trackId:videoTrack.id,start:editorTime,duration:Math.max(.5,Math.min(5,mediaTimelineDuration-editorTime||5)),shotId:selected?.id,slotId:selected?.slots.find(slot=>slot.id===selectedSlotId)?.id??selected?.slots[0]?.id,sourceHasAudio:true,audioTrackId:audioTrack.id,audioClipId:id("timeline-audio")});return {...p,timelineClips:result.timelineClips};});setSelectedTimelineClipId(clipId);setIsPlaying(false);setNotice("Added linked video/audio placeholders. Assign an imported video source in the Inspector.");}catch(error){setNotice(error instanceof Error?error.message:"Could not add timeline clips.");}
}}><Plus size={14}/> Add linked video/audio</button>
<button className="button button-quiet button-small" onClick={() => {
 const audioTrack=project.tracks.find(track=>track.kind==="audio");if(!audioTrack){setNotice("Add an audio track first.");return;}
 const clipId=id("timeline-audio");change(p=>({...p,timelineClips:[...(p.timelineClips??[]),{id:clipId,name:"Audio clip "+((p.timelineClips??[]).filter(clip=>clip.kind==="audio"&&!clip.id.startsWith("storyboard-")).length+1),kind:"audio",trackId:audioTrack.id,start:editorTime,duration:Math.max(.5,Math.min(5,mediaTimelineDuration-editorTime||5))}]}));setSelectedTimelineClipId(clipId);setIsPlaying(false);setNotice("Added an audio clip. Assign an imported audio source in the Inspector.");
}}><Plus size={14}/> Add audio clip</button>
<button className="button button-quiet button-small" onClick={()=>addMasterLayerClip("text")}><Plus size={14}/> Text block</button>
<button className="button button-quiet button-small" onClick={()=>addMasterLayerClip("procedural")}><Plus size={14}/> Three.js module</button>
<button className={"button button-quiet button-small ripple-reorder-toggle"+(rippleReorderMode?" active":"")} aria-pressed={rippleReorderMode} onClick={()=>setRippleReorderMode(enabled=>!enabled)}>{rippleReorderMode?"Ripple Reorder: ON":"Enable Ripple Reorder"}</button>
<button className="button button-quiet button-small" onClick={()=>change(p=>({...p,tracks:[...p.tracks,{id:id("track-video"),name:"Video "+(p.tracks.filter(track=>track.kind==="video").length+1),kind:"video"}]}))}><Plus size={14}/> Video track</button>
<button className="button button-quiet button-small" onClick={()=>change(p=>({...p,tracks:[...p.tracks,{id:id("track-audio"),name:"Audio "+(p.tracks.filter(track=>track.kind==="audio").length+1),kind:"audio"}]}))}><Plus size={14}/> Audio track</button>
<button className="button button-quiet button-small" onClick={()=>change(p=>({...p,tracks:[...p.tracks,{id:id("track-procedural"),name:"Three.js Layer "+(p.tracks.filter(track=>track.kind==="procedural").length+1),kind:"procedural"}]}))}><Plus size={14}/> Three.js layer</button>
</div></div>
{rippleReorderMode&&<p className="ripple-mode-note" role="status">Ripple Reorder is ON. Dropping a Shot changes chronological order and packs the full Master sequence back-to-back, closing gaps. Master durations and Version internals stay unchanged.</p>}
<div className="visual-track-list">
{project.tracks.filter(track=>track.kind==="video"||track.kind==="audio"||track.kind==="procedural"||track.kind==="text"||track.kind==="effects").map(track=>{
 const clips=(project.timelineClips??[]).filter(clip=>clip.trackId===track.id && !(track.kind==="audio" && clip.linkedVideoClipId));
 return <div className="visual-track-group" key={track.id}>
 <div className="visual-track-row">
  <div className="visual-track-label">
   {track.kind==="video" && <button className="track-expand-toggle" aria-label={(collapsedVideoTrackIds.includes(track.id)?"Expand ":"Collapse ")+track.name} aria-expanded={!collapsedVideoTrackIds.includes(track.id)} onClick={()=>setCollapsedVideoTrackIds(current=>current.includes(track.id)?current.filter(id=>id!==track.id):[...current,track.id])}>{collapsedVideoTrackIds.includes(track.id)?"▸":"▾"}</button>}
   <span className={track.kind==="audio"?"track-kind-audio":"track-kind-video"}>{track.kind==="audio"?<AudioLines size={15}/>:track.kind==="procedural"?<Layers3 size={15}/>:track.kind==="text"?<Sparkles size={15}/>:<Film size={15}/>}</span><div><strong>{track.name||track.kind}</strong><small>{track.kind==="audio"?"Audio layer":track.kind==="procedural"?"Three.js layer":track.kind==="text"?"Text layer":track.kind==="effects"?"Effects layer":"Video layer"}</small></div>{track.kind==="audio" && <button className={"track-layer-mute"+(track.muted?" muted":"")} aria-label={(track.muted?"Unmute ":"Mute ")+track.name+" layer"} aria-pressed={Boolean(track.muted)} title={track.muted?"Unmute audio layer":"Mute audio layer"} onClick={event=>{event.stopPropagation();change(p=>({...p,tracks:p.tracks.map(item=>item.id===track.id?{...item,muted:!item.muted}:item)}));}}>{track.muted?"Unmute":"Mute"}</button>}
  </div>
  <div className="visual-track-lane" style={{backgroundSize:(5/mediaTimelineDuration*100)+"% 100%"}}
   onPointerDown={event=>{if(event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();const next=Math.max(0,Math.min(activeTimelineDuration,((event.clientX-rect.left)/Math.max(rect.width,1))*mediaTimelineDuration));playbackTimeRef.current=next;setIsPlaying(false);setEditorTime(next);}}
   onDragOver={event=>event.preventDefault()}
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
     const next=Math.max(0,((event.clientX-rect.left)/Math.max(rect.width,1))*mediaTimelineDuration-moving.duration/2);
     try{change(p=>{const result=moveTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},moving.id,next);return {...p,timelineClips:result.timelineClips.map(clip=>clip.id===moving.id?{...clip,trackId:track.id}:clip)};});setSelectedTimelineClipId(moving.id);setIsPlaying(false);}catch(error){setNotice(error instanceof Error?error.message:"Could not move the clip.");}
   }}>
   <div className="visual-playhead" style={{left:(editorTime/mediaTimelineDuration*100)+"%"}}/>
   {clips.map(clip=>{
     const versionShot=clip.shotId?project.shots.find(shot=>shot.id===clip.shotId):selected;
     const versionSlot=versionShot?(clip.slotId?versionShot.slots.find(slot=>slot.id===clip.slotId):versionShot.slots.find(slot=>slot.id===selectedSlotId)??versionShot.slots[0]):undefined;
     const activeVersion=versionSlot?.versions.find(version=>version.id===versionSlot.selectedVersionId);
     const activeVisualLayer=activeVersion?.layers.find(layer=>layer.kind==="video"||layer.kind==="image");
     const clipAsset=clip.assetId?project.assets.find(asset=>asset.id===clip.assetId):undefined;
     const activeVisualAsset=activeVisualLayer?.assetId?project.assets.find(asset=>asset.id===activeVisualLayer.assetId):undefined;
     const thumbnailPath=clip.thumbnailPath??getAssetThumbnail(clipAsset)??activeVisualLayer?.thumbnailPath??getAssetThumbnail(activeVisualAsset);
     return <div className="visual-media-clip-wrap" key={clip.id} style={{left:(clip.start/mediaTimelineDuration*100)+"%",width:Math.max(2,clip.duration/mediaTimelineDuration*100)+"%"}}>
       <button draggable className={"visual-media-clip "+(clip.kind==="audio"?"audio-clip":clip.kind==="text"?"text-clip":clip.kind==="procedural"?"procedural-clip":"video-clip")+(clip.id===selectedTimelineClipId?" selected":"")} onDragStart={event=>{event.dataTransfer.setData("text/dionysus-timeline-clip",clip.id);event.dataTransfer.effectAllowed="move";}} onClick={()=>{setSelectedTimelineClipId(clip.id);const next=Math.min(activeTimelineDuration,clip.start);playbackTimeRef.current=next;setIsPlaying(false);setEditorTime(next);}} title={clip.name+" · "+clip.start.toFixed(1)+"–"+(clip.start+clip.duration).toFixed(1)+"s"}><span className="visual-clip-icon">{clip.kind==="audio"?<AudioLines size={13}/>:clip.kind==="text"?<Sparkles size={13}/>:clip.kind==="procedural"?<Layers3 size={13}/>:thumbnailPath?<img className="visual-clip-thumbnail" src={thumbnailPath} alt=""/>:<span className="visual-clip-thumbnail-placeholder"><Film size={13}/></span>}</span><span className="visual-clip-copy"><strong>{clip.name}</strong><small>{clip.duration.toFixed(1)}s{clip.linkedVideoClipId?" · linked":clip.kind==="audio"?" · independent":""}{clip.assetId?"":" · no source"}</small></span></button>
       {clip.kind==="audio" && <button className="timeline-clip-mute" aria-label={(clip.muted?"Unmute ":"Mute ")+clip.name} aria-pressed={Boolean(clip.muted)} onClick={()=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id===clip.id?{...item,muted:!item.muted}:item)}))}>{clip.muted?"🔇":"♪"}</button>}
       {clip.kind==="video" && versionShot && versionSlot && <details className="timeline-version-menu"><summary aria-label={"Show versions for "+versionShot.title}>▾</summary><div className="timeline-version-menu-panel">
         <strong>{versionShot.title}</strong>
         {versionSlot.versions.map((version,vi)=><div className="timeline-version-menu-row" key={version.id}>
           <button className={version.id===versionSlot.selectedVersionId?"chosen":""} onClick={()=>{setSelectedId(versionShot.id);setSelectedSlotId(versionSlot.id);chooseSlotVersion(versionShot.id,versionSlot.id,version.id);}}><span>{version.name||"Version "+(vi+1)}</span><small>{version.layers.some(layer=>layer.kind==="procedural")?"Three.js / mix":version.layers.some(layer=>layer.kind==="video")?"Video":version.layers.some(layer=>layer.kind==="image")?"Image":"Composition"} · {version.duration}s</small></button>
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
     const visualLayer=version?.layers.find(layer=>layer.kind==="video"||layer.kind==="image");
     const visualAsset=visualLayer?.assetId?project.assets.find(asset=>asset.id===visualLayer.assetId):undefined;
     const previewAsset=shot.previewAssetId?project.assets.find(asset=>asset.id===shot.previewAssetId):undefined;
     const thumb=visualLayer?.thumbnailPath??getAssetThumbnail(visualAsset)??getAssetThumbnail(previewAsset);
     return <div className="master-shot-clip-wrap" key={"master-shot-"+shot.id} style={{left:(shotStart/mediaTimelineDuration*100)+"%",width:Math.max(2,shot.duration/mediaTimelineDuration*100)+"%"}}>
       <button draggable className={"master-shot-clip"+(selected?.id===shot.id?" selected":"")} onDragStart={event=>{event.dataTransfer.setData("text/dionysus-master-shot",shot.id);event.dataTransfer.effectAllowed="move";}} onClick={()=>{setSelectedId(shot.id);if(slot)setSelectedSlotId(slot.id);setIsPlaying(false);setEditorTime(shotStart);playbackTimeRef.current=shotStart;}} title={shot.title+" · "+shot.duration.toFixed(1)+"s"}>
         {thumb?<img className="master-shot-thumbnail" src={thumb} alt=""/>:<span className="master-shot-placeholder"><Film size={13}/></span>}
         <span className="master-shot-copy"><strong>{shot.title}</strong><small>{version?.name??"No version"} · {shot.duration.toFixed(1)}s</small></span>
       </button>
       {slot && <details className="timeline-version-menu master-shot-version-menu"><summary aria-label={"Show versions for "+shot.title}>▾</summary><div className="timeline-version-menu-panel">
         <strong>{shot.title}</strong>
         {slot.versions.map((item,vi)=><div className="timeline-version-menu-row" key={item.id}>
           <button className={item.id===slot.selectedVersionId?"chosen":""} onClick={()=>{setSelectedId(shot.id);setSelectedSlotId(slot.id);chooseSlotVersion(shot.id,slot.id,item.id);}}><span>{item.name||"Version "+(vi+1)}</span><small>{item.layers.some(layer=>layer.kind==="procedural")?"Three.js / mix":item.layers.some(layer=>layer.kind==="video")?"Video":item.layers.some(layer=>layer.kind==="image")?"Image":"Composition"} · {item.duration}s</small></button>
           <button className="timeline-version-edit" onClick={()=>openVersionTimeline(shot.id,slot.id,item.id)}>Edit</button>
         </div>)}
         <button className="timeline-version-add" onClick={()=>{setSelectedId(shot.id);setSelectedSlotId(slot.id);createSlotVersion(shot.id,slot.id);}}>＋ Add Version</button>
       </div></details>}
     </div>;
   })}
   {!clips.length && !(track.kind==="video" && project.tracks.find(item=>item.kind==="video")?.id===track.id && project.shots.length>0) && <span className="visual-track-empty">{track.kind==="procedural"?"Procedural modules are available inside a Shot Version tab.":track.kind==="text"?"Timed text lane — text modules are edited in a Shot Version tab.":track.kind==="effects"?"No effects assigned to this lane.":"Drop or add a clip to this lane"}</span>}
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
        <button className={"visual-media-clip audio-clip"+(audio.id===selectedTimelineClipId?" selected":"")} onClick={()=>{setSelectedTimelineClipId(audio.id);setEditorTime(audio.start);setIsPlaying(false);playbackTimeRef.current=audio.start;}} title={audio.name+" · "+audio.duration.toFixed(1)+"s"}><span className="visual-clip-icon"><AudioLines size={13}/></span><span className="visual-clip-copy"><strong>{audio.name}</strong><small>{audio.duration.toFixed(1)}s · linked</small></span></button>
        <button className="timeline-clip-mute" aria-label={(audio.muted?"Unmute ":"Mute ")+audio.name} aria-pressed={Boolean(audio.muted)} onClick={()=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id===audio.id?{...item,muted:!item.muted}:item)}))}>{audio.muted?"🔇":"♪"}</button>
        <button className="timeline-clip-unlink" title="Unlink source audio" aria-label={"Unlink "+audio.name} onClick={()=>{try{change(p=>({...p,timelineClips:unlinkTimelineAudio({tracks:p.tracks,timelineClips:p.timelineClips??[]},audio.id).timelineClips}));setNotice("Audio unlinked and moved into the independent audio lane.");}catch(error){setNotice(error instanceof Error?error.message:"Unlink failed.");}}}>Unlink</button>
      </div>)}
    </div>
   </div>;
 })}
 </div>
 })}
 </div>
{selectedTimelineClip&&<div className="visual-clip-inspector">
<div className="visual-clip-inspector-title"><div><strong>{selectedTimelineClip.name}</strong><span>{selectedTimelineClip.kind} · {selectedTimelineClip.linkedVideoClipId?"linked source audio":selectedTimelineClip.kind==="audio"?"independent audio":"video source"}</span></div><button className="button button-quiet button-small" onClick={()=>setSelectedTimelineClipId("")}>Close</button></div>
<div className="visual-clip-actions">
<button onClick={()=>{try{change(p=>({...p,timelineClips:moveTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},selectedTimelineClip.id,Math.max(0,selectedTimelineClip.start-.5)).timelineClips}));setIsPlaying(false);}catch(error){setNotice(error instanceof Error?error.message:"Move failed.");}}}>−0.5s</button>
<button onClick={()=>{try{change(p=>({...p,timelineClips:moveTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},selectedTimelineClip.id,selectedTimelineClip.start+.5).timelineClips}));setIsPlaying(false);}catch(error){setNotice(error instanceof Error?error.message:"Move failed.");}}}>+0.5s</button>
<button onClick={()=>{try{change(p=>({...p,timelineClips:trimTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},selectedTimelineClip.id,Math.max(.1,selectedTimelineClip.duration-.5)).timelineClips}));setIsPlaying(false);}catch(error){setNotice(error instanceof Error?error.message:"Trim failed.");}}}>Trim −0.5s</button>
{selectedTimelineClip.kind==="audio"&&selectedTimelineClip.linkedVideoClipId&&<button onClick={()=>{try{change(p=>({...p,timelineClips:unlinkTimelineAudio({tracks:p.tracks,timelineClips:p.timelineClips??[]},selectedTimelineClip.id).timelineClips}));setNotice("Audio unlinked; it can now be edited independently.");}catch(error){setNotice(error instanceof Error?error.message:"Unlink failed.");}}}>Unlink audio</button>}
<button className="danger-action" onClick={()=>{change(p=>({...p,timelineClips:deleteTimelineClip({tracks:p.tracks,timelineClips:p.timelineClips??[]},selectedTimelineClip.id).timelineClips}));setSelectedTimelineClipId("");}}>Delete clip</button>
</div>
<div className="visual-clip-timing"><span>Start <strong>{selectedTimelineClip.start.toFixed(1)}s</strong></span><span>End <strong>{(selectedTimelineClip.start+selectedTimelineClip.duration).toFixed(1)}s</strong></span><span>Duration <strong>{selectedTimelineClip.duration.toFixed(1)}s</strong></span></div>
<label className="field-label">Source asset<select className="text-field" aria-label={selectedTimelineClip.name+" timeline source asset"} value={selectedTimelineClip.assetId??""} onChange={event=>{const assetId=event.target.value||undefined;change(p=>({...p,timelineClips:(p.timelineClips??[]).map(clip=>{const linked=clip.id===selectedTimelineClip.id||clip.id===selectedTimelineClip.linkedVideoClipId||(selectedTimelineClip.kind==="video"&&clip.kind==="audio"&&clip.linkedVideoClipId===selectedTimelineClip.id);return linked?{...clip,assetId}:clip;})}));}}>
<option value="">No source assigned</option>{project.assets.filter(asset=>selectedTimelineClip.kind==="video"?asset.kind==="video":selectedTimelineClip.kind==="audio"?asset.kind==="audio"||(Boolean(selectedTimelineClip.linkedVideoClipId)&&asset.kind==="video"):selectedTimelineClip.kind==="procedural"?asset.kind==="script":false).map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}
</select></label>
{selectedTimelineClip.kind==="text" && <label className="field-label">Displayed text<input className="text-field" aria-label="Text block content" value={selectedTimelineClip.name} onChange={event=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(clip=>clip.id===selectedTimelineClip.id?{...clip,name:event.target.value}:clip)}))}/></label>}
{selectedTimelineClip.kind==="procedural" && <label className="field-label">Pinned script / scene version ID<input className="text-field" aria-label="Three.js script version ID" value={selectedTimelineClip.scriptVersionId??""} onChange={event=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(clip=>clip.id===selectedTimelineClip.id?{...clip,scriptVersionId:event.target.value||undefined}:clip)}))} placeholder="Saved, authorized script version ID"/></label>}
{(selectedTimelineClip.kind==="video"||selectedTimelineClip.kind==="audio") && <div className="visual-provenance-grid">
<label>Source in (s)<input className="text-field" type="number" min="0" step="0.1" value={selectedTimelineClip.sourceIn??0} disabled={selectedTimelineClip.kind==="audio"&&Boolean(selectedTimelineClip.linkedVideoClipId)} onChange={event=>{const sourceIn=Math.max(0,Number(event.target.value)||0);const sourceOut=Math.max(sourceIn+.1,selectedTimelineClip.sourceOut??sourceIn+selectedTimelineClip.duration);const duration=sourceOut-sourceIn;change(p=>({...p,timelineClips:(p.timelineClips??[]).map(clip=>clip.id===selectedTimelineClip.id?{...clip,sourceIn,sourceOut,duration}:selectedTimelineClip.kind==="video"&&clip.kind==="audio"&&clip.linkedVideoClipId===selectedTimelineClip.id?{...clip,sourceIn,sourceOut,duration}:clip)}));}}/></label>
<label>Source out (s)<input className="text-field" type="number" min={(selectedTimelineClip.sourceIn??0)+.1} step="0.1" value={selectedTimelineClip.sourceOut??((selectedTimelineClip.sourceIn??0)+selectedTimelineClip.duration)} disabled={selectedTimelineClip.kind==="audio"&&Boolean(selectedTimelineClip.linkedVideoClipId)} onChange={event=>{const sourceOut=Math.max((selectedTimelineClip.sourceIn??0)+.1,Number(event.target.value)||.1);const duration=sourceOut-(selectedTimelineClip.sourceIn??0);change(p=>({...p,timelineClips:(p.timelineClips??[]).map(clip=>clip.id===selectedTimelineClip.id?{...clip,sourceOut,duration}:selectedTimelineClip.kind==="video"&&clip.kind==="audio"&&clip.linkedVideoClipId===selectedTimelineClip.id?{...clip,sourceOut,duration}:clip)}));}}/></label>
</div>}
<div className="visual-provenance-grid"><label>Generation model<input className="text-field" value={selectedTimelineClip.modelName??""} placeholder="e.g. provider/model" onChange={event=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(clip=>clip.id===selectedTimelineClip.id?{...clip,modelName:event.target.value}:clip)}))}/></label><label>Model version<input className="text-field" value={selectedTimelineClip.modelVersion??""} placeholder="Optional version" onChange={event=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(clip=>clip.id===selectedTimelineClip.id?{...clip,modelVersion:event.target.value}:clip)}))}/></label></div>
<label className="visual-prompt-field">Generation prompt<textarea className="text-area" rows={3} value={selectedTimelineClip.prompt??""} placeholder="Store the prompt used to generate this source clip" onChange={event=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(clip=>clip.id===selectedTimelineClip.id?{...clip,prompt:event.target.value}:clip)}))}/></label>
<p className="inline-note">Assign a source asset to preview it. Audio clips play from their source range while the master playhead runs.</p>
</div>}
</section></div>
{activeTimelineTabId !== "master" && activeVersionTimelineTab && activeVersionTimeline && activeVersionTimelineSlot && activeVersionTimelineShot && <section className="nested-timeline-tab">
  <div className="editor-linked-heading"><div><strong>{activeVersionTimelineShot.title} · {activeVersionTimeline.name}</strong><span>Version timeline · edits here do not change the Master Shot duration</span></div>
    <div className="inline-actions">
      <button className="button button-quiet button-small" onClick={()=>addVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,"video")}><Plus size={13}/> Video</button>
      <button className="button button-quiet button-small" onClick={()=>addVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,"image")}><Plus size={13}/> Image</button>
      <button className="button button-quiet button-small" onClick={()=>addVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,"audio")}><Plus size={13}/> Audio</button>
      <button className="button button-quiet button-small" onClick={()=>addVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,"text")}><Plus size={13}/> Text</button>
      <button className="button button-quiet button-small" onClick={()=>addVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,"procedural")}><Plus size={13}/> Three.js layer</button>
      <label className="nested-version-duration">Version duration <span><input aria-label="Version duration" type="number" min="0.1" step={1/Math.max(1,project.frameRate)} value={activeVersionTimeline.duration} onChange={event=>updateVersionDuration(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,Number(event.target.value))}/>s</span></label>
    </div>
  </div>
  <div className="nested-timeline-ruler" aria-label="Version timeline ruler">
    {Array.from({length:Math.floor(activeVersionTimeline.duration/2)+1},(_,i)=>i*2).concat(activeVersionTimeline.duration%2===0?[]:[activeVersionTimeline.duration]).map(sec=><span key={sec} style={{left:(sec/Math.max(activeVersionTimeline.duration,0.1)*100)+"%"}}>{time(sec)}</span>)}
    <div className="nested-timeline-playhead" style={{left:(Math.min(editorTime,activeVersionTimeline.duration)/Math.max(activeVersionTimeline.duration,0.1)*100)+"%"}}/>
  </div>
  <div className="nested-timeline-lanes">
    {activeVersionTimeline.layers.map(layer=><div className="nested-timeline-row" key={layer.id}>
      <div className="nested-timeline-row-label"><span>{layer.kind==="procedural"?"◇":layer.kind==="audio"?"♫":layer.kind==="text"?"T":layer.kind==="image"?"▧":layer.kind==="script"?"&lt;/&gt;":"▣"}</span><div><strong>{layer.name}</strong><small>{layer.kind==="procedural"?"Three.js / procedural":layer.kind}</small></div>
        <button className="layer-order-button" aria-label={"Move " + layer.name + " earlier"} title="Move layer earlier" disabled={activeVersionTimeline.layers.findIndex(item=>item.id===layer.id)===0} onClick={()=>moveVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,layer.id,-1)}>↑</button>
        <button className="layer-order-button" aria-label={"Move " + layer.name + " later"} title="Move layer later" disabled={activeVersionTimeline.layers.findIndex(item=>item.id===layer.id)===activeVersionTimeline.layers.length-1} onClick={()=>moveVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,layer.id,1)}>↓</button>
        {layer.kind==="audio" && <button className="layer-mute-toggle" aria-pressed={Boolean(layer.muted)} onClick={()=>updateCompositionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,layer.id,{muted:!layer.muted})}>{layer.muted?"Unmute":"Mute"}</button>}
        <button className="layer-remove" aria-label={"Delete " + layer.name} onClick={()=>removeVersionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,layer.id)}>×</button>
      </div>
      <div className="nested-timeline-row-track">
        <button draggable className={"nested-timeline-clip kind-" + layer.kind} style={{left:(layer.start/Math.max(activeVersionTimeline.duration,0.1)*100)+"%",width:Math.max(1.5,layer.duration/Math.max(activeVersionTimeline.duration,0.1)*100)+"%"}} onDragStart={event=>{event.dataTransfer.setData("text/dionysus-version-layer",layer.id);event.dataTransfer.effectAllowed="move";}} onDragEnd={event=>{const lane=event.currentTarget.parentElement;const rect=lane?.getBoundingClientRect();if(!rect)return;const fps=Math.max(1,project.frameRate||24);const pointer=((event.clientX-rect.left)/Math.max(rect.width,1))*activeVersionTimeline.duration;const maxStart=Math.max(0,activeVersionTimeline.duration-layer.duration);const rawStart=Math.max(0,Math.min(maxStart,pointer-layer.duration/2));const next=Math.round(rawStart*fps)/fps;updateCompositionLayer(activeVersionTimelineShot.id,activeVersionTimelineSlot.id,activeVersionTimeline.id,layer.id,{start:next});playbackTimeRef.current=next;setEditorTime(next);setIsPlaying(false);}} onClick={()=>setEditorTime(layer.start)} title={layer.name+" · "+layer.start.toFixed(1)+"–"+(layer.start+layer.duration).toFixed(1)+"s"}><strong>{layer.name}</strong><small>{layer.duration.toFixed(1)}s</small></button>
        {layer.kind==="procedural" && <span className="procedural-layer-note">Script/module output is not connected to the final compositor yet.</span>}
      </div>
    </div>)}
    {!activeVersionTimeline.layers.length && <div className="nested-timeline-empty">This Version has no internal layers yet. Add a video, image, audio, text, or Three.js layer above.</div>}
    {activeVersionTimeline.layers.some(layer=>layer.start+layer.duration>activeVersionTimeline.duration) && <div className="nested-timeline-warning" role="status">One or more modules extend past this Version's duration and may be cut off in preview/export. Their timing has not been changed automatically.</div>}
  </div>
</section>}
{selected && (() => { const activeSlot = selected.slots.find(slot => slot.id === selectedSlotId); if (!activeSlot) return null; const activeVersion = activeSlot.versions.find(version => version.id === (activeVersionTimelineTab?.slotId === activeSlot.id ? activeVersionTimelineTab.versionId : activeSlot.selectedVersionId)); return <section className={"version-panel " + (activeTimelineTabId !== "master" ? "nested-version-inspector" : "")}><div className="version-panel-heading"><div><span className="inspector-kicker">{activeTimelineTabId === "master" ? "CLIP SLOT" : "VERSION INSPECTOR"}</span><label className="field-label">Clip slot name<input className="text-field" aria-label="Clip slot name" value={activeSlot.name} onChange={e => updateSlotName(selected.id, activeSlot.id, e.target.value)} /></label><p>{activeSlot.duration}s · {activeSlot.versions.length} version{activeSlot.versions.length === 1 ? "" : "s"}</p></div><button className="button button-quiet button-small" onClick={() => setSelectedSlotId("")}>Close</button></div><div className="slot-timing-controls">
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
                        <label>Module duration (seconds)<input className="text-field" aria-label={"Version layer " + layer.id + " duration"} type="number" min="0.1" step={1/Math.max(1,project.frameRate)} value={layer.duration} onChange={event=>{const next=Math.max(0.1,Math.min(Number(event.target.value)||0.1,Math.max(0.1,activeVersion.duration-layer.start)));updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{duration:next});}}/></label>
                      </div>
                      <div className="visual-provenance-grid"><label>Layer type<select className="text-field" aria-label={layer.name + " layer type"} value={layer.kind} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{kind:e.target.value as CompositionLayer["kind"],assetId:undefined})}><option value="video">Video</option><option value="image">Image</option><option value="audio">Audio</option><option value="text">Text</option><option value="composition">Composition placeholder</option><option value="script">Script</option><option value="procedural">Three.js / procedural</option></select></label>
                        <label>Source asset<select className="text-field" aria-label={layer.name + " source asset"} value={layer.assetId??""} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{assetId:e.target.value||undefined})}><option value="">No source assigned</option>{project.assets.filter(asset=>layer.kind==="video"?asset.kind==="video":layer.kind==="image"?asset.kind==="image":layer.kind==="audio"?asset.kind==="audio":layer.kind==="procedural"||layer.kind==="script"?asset.kind==="script":false).map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                      </div>{layer.kind==="procedural" && <label className="field-label">Pinned script / scene version ID<input className="text-field" aria-label={layer.name + " script version ID"} value={layer.scriptVersionId ?? ""} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{scriptVersionId:e.target.value||undefined})} placeholder="Use a saved, authorized script version ID"/></label>}<div className="composition-frame-controls"><label>Fit mode<select className="text-field" aria-label={layer.name + " fit mode"} value={layer.fitMode ?? "contain"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{fitMode:e.target.value as CompositionLayer["fitMode"]})}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label><label>X (%)<input className="text-field" type="number" value={layer.x ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{x:Number(e.target.value)||0})}/></label><label>Y (%)<input className="text-field" type="number" value={layer.y ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{y:Number(e.target.value)||0})}/></label><label>Width (%)<input className="text-field" type="number" min="1" max="100" value={layer.width ?? 100} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{width:Math.max(1,Math.min(100,Number(e.target.value)||1))})}/></label><label>Height (%)<input className="text-field" type="number" min="1" max="100" value={layer.height ?? 100} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{height:Math.max(1,Math.min(100,Number(e.target.value)||1))})}/></label><label>Frame shape<select className="text-field" value={layer.shape ?? "rectangle"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{shape:e.target.value as CompositionLayer["shape"]})}><option value="rectangle">Rectangle</option><option value="rounded">Rounded</option><option value="circle">Circle</option></select></label><label>Background<input className="text-field" type="color" value={layer.backgroundColor ?? "#111113"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{backgroundColor:e.target.value})}/></label><label>Border color<input className="text-field" type="color" value={layer.borderColor ?? "#000000"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{borderColor:e.target.value})}/></label><label>Border width (px)<input className="text-field" type="number" min="0" value={layer.borderWidth ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{borderWidth:Math.max(0,Number(e.target.value)||0)})}/></label><label>Corner radius (px)<input className="text-field" type="number" min="0" value={layer.cornerRadius ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{cornerRadius:Math.max(0,Number(e.target.value)||0)})}/></label><label>Scale<input className="text-field" type="number" min="0.01" step="0.1" value={layer.scale ?? 1} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{scale:Math.max(0.01,Number(e.target.value)||0.01)})}/></label><label>Opacity<input className="text-field" type="number" min="0" max="1" step="0.05" value={layer.opacity ?? 1} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{opacity:Math.max(0,Math.min(1,Number(e.target.value)||0))})}/></label><label>Animation<select className="text-field" aria-label={layer.name + " animation"} value={layer.animation ?? "none"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{animation:e.target.value as CompositionLayer["animation"]})}><option value="none">None</option><option value="float">Float</option><option value="pulse">Pulse</option><option value="rotate">Rotate</option></select></label><label>Animation duration (s)<input className="text-field" type="number" min="0.1" max="60" step="0.1" value={layer.animationDuration ?? 3} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{animationDuration:Math.max(0.1,Math.min(60,Number(e.target.value)||3))})}/></label></div>
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
                  <div className="composition-preview" aria-label="Composition frame preview"><div className="composition-preview-canvas" style={{aspectRatio: project.width + "/" + project.height, background: activeVersion.layers.find(layer=>layer.backgroundColor)?.backgroundColor ?? "#111113"}}>{activeVersion.layers.filter(layer=>["video","image","text","composition"].includes(layer.kind)).map(layer=>{const asset=project.assets.find(item=>item.id===layer.assetId); return <div key={layer.id} className="composition-preview-layer" style={{left:(layer.x??0)+"%",top:(layer.y??0)+"%",width:(layer.width??100)+"%",height:(layer.height??100)+"%",background:layer.backgroundColor??"#24242b",border:`${layer.borderWidth??0}px solid ${layer.borderColor??"#000000"}`,borderRadius:layer.shape==="circle"?"50%":layer.shape==="rounded"?(layer.cornerRadius??12)+"px":"0",opacity:layer.opacity??1,transform:`scale(${layer.scale??1})`,transformOrigin:"center",animation:layer.animation&&layer.animation!=="none"?`dys-${layer.animation} ${layer.animationDuration??3}s ease-in-out infinite alternate`:undefined}}>{asset?.path?.startsWith("data:image/")?<img src={asset.path} alt={asset.name} style={{width:"100%",height:"100%",objectFit:layer.fitMode??"contain"}}/>:<span>{layer.name}{layer.prompt?" · prompt saved":""}</span>}</div>})}</div><small>Live composition frame preview · export renders selected shot versions to WebM.</small><h4>Procedural animation · Three.js</h4><ProceduralAnimationPreview width={project.width} height={project.height} layers={activeVersion.layers.filter(layer=>layer.kind!=="audio")}/><small>Live WebGL motion preview. This is a procedural preview, not a final video render.</small></div>
                  <div className="inline-actions"><button className="button button-primary button-small" onClick={()=>change(p=>({...p,shots:p.shots.map(shot=>shot.id!==selected.id?shot:{...shot,slots:shot.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:[...version.layers,{id:id("submodule"),name:"Submodule "+(version.layers.length+1),kind:"video" as const,start:0,duration:Math.max(0.1,version.duration)}]})})})}))}><Plus size={14}/> Add submodule</button><button className="button button-quiet button-small" onClick={()=>recordVersionGeneration(selected.id,activeSlot.id,activeVersion.id)}>Record generation source</button></div>
                </section>}
              </section>; })()}<div className="timeline-note"><CircleHelp size={15}/><span>{t("timeline.planningNote")}</span></div></>}
          {view === "assets" && <><div className="section-toolbar"><div><h2>{t("assets.title")}</h2><p>{t("assets.description")}</p></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={() => assetFileInput.current?.click()}><Upload size={14}/> {t("asset.actionImport")}</button><button className="button button-primary button-small" onClick={() => setShowAssetForm(v => !v)}><Plus size={15}/> {t("asset.actionAdd")}</button></div><input ref={assetFileInput} type="file" accept="video/*,image/*,audio/*,.js,.mjs,.ts,.html" hidden onChange={e => importAssetFile(e.target.files?.[0])}/></div>{showAssetForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addAsset(assetDraftName, assetDraftKind, assetDraftNotes); }}><label className="field-label">{t("asset.nameLabel")}<input className="text-field" value={assetDraftName} onChange={e => setAssetDraftName(e.target.value)} placeholder={t("asset.namePlaceholder")} required/></label><label className="field-label">{t("asset.kindLabel")}<select className="text-field" value={assetDraftKind} onChange={e => setAssetDraftKind(e.target.value as AssetKind)}>{(["video","image","audio","script","other"] as AssetKind[]).map(kind => <option key={kind} value={kind}>{t(("media."+kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</option>)}</select></label><label className="field-label">{t("asset.notesLabel")}<input className="text-field" value={assetDraftNotes} onChange={e => setAssetDraftNotes(e.target.value)} placeholder={t("asset.notesPlaceholder")}/></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.save")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowAssetForm(false)}>{t("action.cancel")}</button></div></form>}{project.assets.length === 0 ? <div className="empty-state"><div className="empty-icon"><Film size={23}/></div><h3>{t("assets.emptyTitle")}</h3><p>{t("assets.emptyDescription")}</p></div> : <div className="asset-grid">{project.assets.map(a => <article className="asset-card" key={a.id}><div className="asset-card-head"><Film size={19}/><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeAsset(a.id)}>×</button></div><input className="text-field asset-name-field" aria-label={t("asset.nameLabel")} value={a.name} onChange={e => updateAsset(a.id, { name: e.target.value })}/><span>{t(("media." + a.kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</span>{a.kind === "image" && a.path?.startsWith("data:image/") && <button type="button" className="button button-quiet button-small" aria-pressed={previewAssetId === a.id} onClick={() => { setPreviewAssetId(a.id); setView("timeline"); setNotice("Preview selected in timeline: " + a.name); }}>Preview in editor</button>}{a.path && <small className="asset-path">{a.path.startsWith("data:image/") ? "Image stored locally for preview" : a.path}</small>}<input className="text-field asset-notes-field" aria-label={t("asset.notesLabel")} value={a.notes ?? ""} placeholder={t("asset.notesPlaceholder")} onChange={e => updateAsset(a.id, { notes: e.target.value })}/><input className="text-field" aria-label="Asset generation prompt" value={a.prompt??""} placeholder="Generation prompt" onChange={e=>updateAsset(a.id,{prompt:e.target.value})}/><input className="text-field" aria-label="Asset generation model" value={a.modelName??""} placeholder="Generation model" onChange={e=>updateAsset(a.id,{modelName:e.target.value})}/><input className="text-field" aria-label="Asset model version" value={a.modelVersion??""} placeholder="Model version" onChange={e=>updateAsset(a.id,{modelVersion:e.target.value})}/></article>)}</div>}<p className="inline-note"><CircleHelp size={13}/>{t("assets.importMetadataOnly")}</p></>}
          {view === "references" && <><div className="section-toolbar"><div><h2>{t("references.title")}</h2><p>{t("references.description")}</p></div><button className="button button-primary button-small" onClick={() => setShowProfileForm(v => !v)}><Plus size={15}/> {t("references.actionNewProfile")}</button></div>{showProfileForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addReferenceProfile(); }}><label className="field-label">{t("profile.nameLabel")}<input className="text-field" value={profileDraftName} onChange={e => setProfileDraftName(e.target.value)} placeholder={t("profile.namePlaceholder")} required/></label><label className="field-label">{t("profile.typeLabel")}<select className="text-field" value={profileDraftType} onChange={e => setProfileDraftType(e.target.value as ReferenceProfile["entityType"])}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.createProfile")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowProfileForm(false)}>{t("action.cancel")}</button></div></form>}{project.referenceProfiles.length === 0 ? <div className="empty-state"><div className="empty-icon"><Sparkles size={23}/></div><h3>{t("references.emptyTitle")}</h3><p>{t("references.emptyDescription")}</p><div className="reference-example"><span className="ref-chip">{t("reference.identity")}</span><span className="ref-chip">{t("reference.face")}</span><span className="ref-chip">{t("reference.outfit")}</span><span className="ref-chip">{t("reference.lighting")}</span></div></div> : <div className="profile-list">{project.referenceProfiles.map(profile => <article className="profile-card profile-card-expanded" key={profile.id}><div className="profile-heading"><Sparkles size={18}/><input className="text-field profile-name-field" aria-label={t("profile.nameLabel")} value={profile.name} onChange={e => updateReferenceProfile(profile.id, { name: e.target.value })}/><select className="text-field profile-type-field" aria-label={t("profile.typeLabel")} value={profile.entityType} onChange={e => updateReferenceProfile(profile.id, { entityType: e.target.value as ReferenceProfile["entityType"] })}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeReferenceProfile(profile.id)}>×</button></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={() => createStoryboardFromReference(profile.id)}>Create storyboard draft from references</button></div><div className="profile-reference-list">{profile.references.length ? profile.references.map(reference => { const asset = project.assets.find(a => a.id === reference.assetId); return <div className="profile-reference-row" key={reference.id}><span className="profile-reference-name">{asset?.name ?? t("references.missingAsset")}</span><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={reference.role} onChange={e => updateProfileReferenceRole(profile.id, reference.id, e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.remove")} onClick={() => removeProfileReference(profile.id, reference.id)}>×</button></div>; }) : <p className="muted-inline">{t("references.noReferences")}</p>}</div><form className="profile-add-reference" onSubmit={e => { e.preventDefault(); addProfileReference(profile.id); }}><select className="text-field" aria-label={t("references.chooseAsset")} value={referenceAssetId} onChange={e => setReferenceAssetId(e.target.value)}><option value="">{t("references.chooseAsset")}</option>{project.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={referenceRole} onChange={e => setReferenceRole(e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button type="submit" className="button button-quiet button-small" disabled={project.assets.length===0}>{t("references.actionAddReference")}</button></form></article>)}</div>}</>}
        </section>
        <aside className="inspector"><div className="inspector-header"><div><span className="inspector-kicker">{t("inspector.title")}</span><h2>{selected ? t("inspector.shotDetails") : t("inspector.projectDetails")}</h2></div><Settings2 size={17}/></div>{selected ? <div className="inspector-content"><div className="inline-actions"><button className="button button-quiet button-small" disabled={!selected} title="Create an independent copy of this shot" onClick={() => selected && duplicateShot(selected.id)}>Duplicate shot</button><button className="button button-quiet button-small danger-action" disabled={project.shots.length <= 1} title={project.shots.length <= 1 ? "A project must keep at least one shot" : "Delete selected shot"} onClick={() => selected && removeShot(selected.id)}>Delete shot</button></div><label className="field-label">{t("inspector.shotTitle")}</label><input className="text-field" value={selected.title} onChange={e => updateShot(selected.id, { title: e.target.value })}/><label className="field-label">{t("inspector.storyIntent")}</label><textarea className="text-area" placeholder={t("inspector.intentPlaceholder")} value={selected.intent} onChange={e => updateShot(selected.id, { intent: e.target.value })} rows={4}/>{project.shots.some(other=>other.id!==selected.id&&getMasterShotStart(project.shots,selected.id)<getMasterShotStart(project.shots,other.id)+other.duration&&getMasterShotStart(project.shots,other.id)<getMasterShotStart(project.shots,selected.id)+selected.duration)&&<p className="timing-warning master-shot-overlap-warning" role="status">This Master Shot overlaps another Shot. Free placement permits intentional overlaps; enable Ripple Reorder and drop a Shot to pack the sequence without overlaps.</p>}<div className="field-row master-shot-position-row"><div><label className="field-label">Master start (seconds)</label><div className="number-field"><input aria-label="Master Shot start time" type="number" min="0" step="0.1" value={getMasterShotStart(project.shots, selected.id)} onChange={e=>updateMasterShotStart(selected.id, Number(e.target.value))}/><span>s</span></div></div></div><div className="field-row"><div><label className="field-label">{t("inspector.targetDuration")}</label><div className="number-field"><input type="number" min={1} max={600} value={selected.duration} onChange={e => updateShot(selected.id, { duration: Math.max(1, Number(e.target.value) || 1) })}/><span>{t("inspector.secondsShort")}</span></div></div><div><label className="field-label">{t("inspector.status")}</label><select className="text-field" value={selected.status} onChange={e => updateShot(selected.id, { status: e.target.value as Shot["status"] })}><option value="planned">{t("status.planned")}</option><option value="in-progress">{t("status.in-progress")}</option><option value="ready">{t("status.ready")}</option></select></div></div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.clipSlots")}</span><span className="small-count">{selected.slots.length}</span></div><div className="slot-inspector-list">{selected.slots.map(slot => <div className={"slot-inspector " + (selectedSlotId === slot.id ? "selected" : "")} key={slot.id}><div className="slot-icon"><SquarePlay size={16}/></div><button type="button" className="slot-copy slot-select-button" aria-pressed={selectedSlotId === slot.id} onClick={() => { selectClipSlot(slot.id); setEditorTime(Math.min(runtime, selectedStart + slot.start)); }}><strong>{slot.name}</strong><span>{t("slot.versionCount", { duration: slot.duration, count: slot.versions.length })}</span></button><button className="mini-menu" title="Duplicate clip slot" aria-label={"Duplicate clip slot " + slot.name} onClick={() => duplicateSlot(selected.id, slot.id)}>⧉</button><button className="mini-menu danger-action" disabled={selected.slots.length <= 1} title={selected.slots.length <= 1 ? "A shot must keep at least one clip slot" : "Delete clip slot"} onClick={() => removeSlot(selected.id, slot.id)}>×</button></div>)}</div><button className="add-slot-button" onClick={() => addSlot(selected.id)}><Plus size={14}/> {t("action.addClipSlot")}</button><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("shot.references")}</span><span className="small-count">{selected.referenceProfileIds.length}</span></div><div className="shot-reference-list">{project.referenceProfiles.length ? project.referenceProfiles.map(profile => <div className="shot-reference-profile" key={profile.id}><label className="shot-reference-option"><input type="checkbox" checked={selected.referenceProfileIds.includes(profile.id)} onChange={e => toggleShotReferenceProfile(selected.id, profile.id, e.target.checked)}/><span>{profile.name}<small>{t("profile.referencesCount", { count: profile.references.length })}</small></span></label>{selected.referenceProfileIds.includes(profile.id) && profile.references.map(reference => { const asset = project.assets.find(item => item.id === reference.assetId); const override = selected.referenceOverrides.find(item => item.referenceId === reference.id); const replacements = project.assets.filter(item => item.id !== reference.assetId); return <div className="shot-reference-override" key={reference.id}><span>{asset?.name ?? t("references.missingAsset")}<small>{t(("referenceRole."+reference.role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</small></span><select className="text-field override-action" aria-label={t("shot.referenceOverride")} value={override?.action ?? "inherit"} onChange={e => updateShotReferenceOverride(selected.id, reference.id, e.target.value as "inherit" | "exclude" | "replace")}><option value="inherit">{t("referenceOverride.inherit")}</option><option value="exclude">{t("referenceOverride.exclude")}</option><option value="replace" disabled={replacements.length === 0}>{t("referenceOverride.replace")}</option></select>{override?.action === "replace" && <select className="text-field override-asset" aria-label={t("referenceOverride.replacementAsset")} value={override.replacementAssetId ?? ""} onChange={e => updateShotReferenceOverride(selected.id, reference.id, "replace", e.target.value)}>{replacements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>; })}</div>) : <p className="muted-inline">{t("shot.noReferenceProfiles")}</p>}</div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.aiPlanning")}</span><Sparkles size={14}/></div><div className="ai-hint"><WandSparkles size={16}/><p>{t("inspector.aiHint")}</p></div></div> : <div className="empty-inspector">{t("inspector.empty")}</div>}</aside></div>
        <footer className="statusbar"><div><span className="status-check"><Check size={11}/></span><span>{notice}</span></div><div><span><FileJson size={13}/> {t("footer.projectSchema")}</span><span className="statusbar-separator">·</span><span><ShieldCheck size={13}/> {t("footer.localFirst")}</span><span className="statusbar-separator">·</span><span><WandSparkles size={13}/> <span className="future-label">{t("footer.aiReady")}</span></span></div></footer>
      </div>
    </main>

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
