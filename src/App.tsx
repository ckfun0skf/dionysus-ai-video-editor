import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, CheckCircle2, ChevronDown, CircleHelp, Clapperboard, Clock3, Download, FileJson, Film, FolderOpen, Layers3, Maximize2, Plus, Save, Settings2, ShieldCheck, Sparkles, SquarePlay, Upload, WandSparkles, Type, Music2, Captions, Image, Play, Bell, Undo2, Redo2 } from "lucide-react";
import { sampleProject } from "./sampleProject";
import type { Asset, AssetKind, CompositionLayer, DionysusProject, ReferenceProfile, ReferenceRole, Shot } from "./types";
import { validateProject } from "./projectValidation";
import { t } from "./i18n";
import { addVideoClip, moveTimelineClip, trimTimelineClip, unlinkTimelineAudio, deleteTimelineClip } from "./timelineOperations";
import { recordProjectChange, undoProjectChange as undoHistory, redoProjectChange as redoHistory } from "./projectHistory";
import ProceduralAnimationPreview from "./ProceduralAnimationPreview";
import { collectCompositionLayers, renderCompositionFrame, exportCompositionWebM, downloadExport } from "./compositionRenderer";
import AIGenerationPanel from "./AIGenerationPanel";
import { deleteStoredMediaAsset, isStoredMediaPath, storeMediaAsset } from "./mediaAssetStore";
import StoryboardFlowCanvas from "./StoryboardFlowCanvas";
import AgentStoryboardModal from "./AgentStoryboardModal";
import ProductionChecklistDrawer from "./ProductionChecklistDrawer";
type View = "storyboard" | "timeline" | "assets" | "references";
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
  const [editorWorkspace, setEditorWorkspace] = useState(false);
  const [editorTool, setEditorTool] = useState<"video" | "text" | "audio" | "caption" | "image">("text");
  const [editorTime, setEditorTime] = useState(0);
  const [previewAssetId, setPreviewAssetId] = useState("");
  const [showPreviewOverlay, setShowPreviewOverlay] = useState(true);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewRenderId = useRef(0);
  const seekEditorTime = (event: React.PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
    setEditorTime(fraction * runtime);
  };
  const previewImage = previewAssetId === "__none__" ? undefined : project.assets.find(asset => asset.id === previewAssetId && asset.kind === "image" && asset.path?.startsWith("data:image/")) ?? project.assets.find(asset => asset.kind === "image" && asset.path?.startsWith("data:image/"));
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
  const runtime = useMemo(() => project.shots.reduce((n, s) => n + s.duration, 0), [project.shots]);
  const activeShotInfo = useMemo(() => {
    let offset = 0;
    for (let index = 0; index < project.shots.length; index += 1) {
      const shot = project.shots[index];
      if (editorTime < offset + shot.duration || index === project.shots.length - 1) return { shot, index };
      offset += shot.duration;
    }
    return { shot: project.shots[0], index: 0 };
  }, [project.shots, editorTime]);
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    const renderId = ++previewRenderId.current;
    const allLayers = collectCompositionLayers(project);
    const layers = allLayers.length
      ? allLayers.filter(layer => editorTime >= layer.start && editorTime < layer.start + layer.duration)
      : previewImage ? [{ id: "editor-image-fallback", name: previewImage.name, kind: "image" as const, start: 0, duration: Math.max(runtime, 0.1), assetId: previewImage.id, fitMode: "contain" as const, x: 0, y: 0, width: 100, height: 100 }]
      : [];
    const render = async () => {
      const frame = document.createElement("canvas");
      const releases = new Map<string, () => void>();
      try {
        await renderCompositionFrame(frame, project, layers, editorTime, { width: 1280, height: 720 }, new Map(), new Map(), releases);
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
      } finally {
        releases.forEach(release => release());
      }
    };
    void render();
    return () => { if (previewRenderId.current === renderId) previewRenderId.current += 1; };
  }, [project, editorTime, previewImage, runtime]);
  const selectedStart = useMemo(() => { const index = project.shots.findIndex(s => s.id === selectedId); return project.shots.slice(0, Math.max(index, 0)).reduce((n, s) => n + s.duration, 0); }, [project.shots, selectedId]);
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

  function updateShot(shotId: string, patch: Partial<Shot>) { const textField = "title" in patch ? "shot-title:" + shotId : "intent" in patch ? "shot-intent:" + shotId : ""; change(p => ({ ...p, shots: p.shots.map(s => s.id === shotId ? { ...s, ...patch } : s) }), textField); }
  function reorderShots(draggedId: string, targetId: string) { if (draggedId === targetId) return; change(p => { const shots = [...p.shots]; const from = shots.findIndex(s => s.id === draggedId); const to = shots.findIndex(s => s.id === targetId); if (from < 0 || to < 0) return p; const [moved] = shots.splice(from, 1); shots.splice(to, 0, moved); const selectedStart = shots.slice(0, Math.max(0, shots.findIndex(s => s.id === selectedId))).reduce((sum, shot) => sum + shot.duration, 0); setEditorTime(selectedStart); return { ...p, shots }; }); }
  function selectClipSlot(slotId: string) { setSelectedSlotId(slotId); }
  function syncStoryboardToTimeline() {
    const videoTrack = project.tracks.find(track => track.kind === "video");
    const audioTrack = project.tracks.find(track => track.kind === "audio");
    if (!videoTrack || !audioTrack) { setNotice("Timeline needs both video and audio tracks before syncing."); return; }
    let shotOffset = 0;
    const generated = project.shots.flatMap(shot => {
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
          return { id: clipId, name: layer.name || slot.name, kind, trackId: track.id, start: shotOffset + slot.start + layer.start, duration, ...(assetId ? { assetId } : {}), ...(layer.sourceIn !== undefined ? { sourceIn: layer.sourceIn } : {}), ...(layer.sourceOut !== undefined ? { sourceOut: layer.sourceOut } : {}), ...(layer.prompt ? { prompt: layer.prompt } : {}), ...(layer.modelName ? { modelName: layer.modelName } : {}), ...(layer.modelVersion ? { modelVersion: layer.modelVersion } : {}) };
        });
      });
      shotOffset += shot.duration;
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
      void storeMediaAsset(assetId, file).then(path => {
        const asset: Asset = { id: assetId, name: file.name, kind: "video", path, notes: "Attached to shot" };
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
        return { ...slot, duration: safeValue, versions: slot.versions.map(version => ({ ...version, duration: safeValue })) };
      })
    }) }));
    setNotice(field === "start" ? "Clip start time updated." : "Clip duration updated for this slot and its versions.");
  }
  function chooseSlotVersion(shotId: string, slotId: string, versionId: string) {
    change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== shotId ? shot : { ...shot, slots: shot.slots.map(slot => slot.id !== slotId ? slot : { ...slot, selectedVersionId: versionId }) }) }));
    setNotice("Timeline clip version selected.");
  }
  function createSlotVersion(shotId: string, slotId: string) {
    const shot = project.shots.find(item => item.id === shotId);
    const slot = shot?.slots.find(item => item.id === slotId);
    if (!shot || !slot) return;
    const current = slot.versions.find(version => version.id === slot.selectedVersionId) ?? slot.versions[0];
    const nextId = id("version");
    const nextVersion = current ? { ...JSON.parse(JSON.stringify(current)), id: nextId, name: "Version " + String.fromCharCode(65 + slot.versions.length), description: current.description ? "Copy of " + current.name + ": " + current.description : "New version based on " + current.name, layers: current.layers.map(layer => ({ ...layer, id: id("layer") })), scriptVersionIds: [...current.scriptVersionIds], generationRecords: [] } : { id: nextId, name: "Version A", description: "", duration: slot.duration, layers: [], scriptVersionIds: [], generationRecords: [] };
    change(p => ({ ...p, shots: p.shots.map(item => item.id !== shotId ? item : { ...item, slots: item.slots.map(s => s.id !== slotId ? s : { ...s, versions: [...s.versions, nextVersion], selectedVersionId: nextId }) }) }));
    setNotice("New version created; the previous versions are preserved.");
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
  function addAsset(name: string, kind: AssetKind, notes = "", path?: string) {
    const cleanName = name.trim();
    if (!cleanName) { setNotice(t("error.assetNameRequired")); return; }
    const asset: Asset = { id: id("asset"), name: cleanName, kind, notes: notes.trim(), ...(path ? { path } : {}) };
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
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") addAsset(file.name, kind, "Imported image available for local preview.", reader.result);
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
      void storeMediaAsset(assetId, file).then(path => {
        const asset: Asset = { id: assetId, name: file.name, kind, notes: "Imported media stored locally in IndexedDB.", path };
        change(p => ({ ...p, assets: [...p.assets, asset] }));
        setNotice(file.name + " imported and ready for composition.");
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
      <header className="topbar"><div className="breadcrumbs"><span>{t("breadcrumb.projects")}</span><span className="crumb-sep">/</span><strong>{project.name}</strong><span className="local-pill"><span/> {t("status.localBadge")}</span></div><div className="top-actions"><button className="button button-quiet" onClick={() => fileInput.current?.click()}><FolderOpen size={15}/> {t("action.openProject")}</button><button className="button button-quiet" onClick={exportProject}><Save size={15}/> {t("action.exportProject")}</button><button className="button button-quiet" onClick={() => setEditorWorkspace(true)}><Film size={15}/> Studio Editor</button><button className="button button-quiet" onClick={() => void exportVideo()}><Film size={15}/> Export WebM</button><button className="button button-primary" onClick={exportPlan}><Download size={15}/> {t("action.exportPlan")}</button><input ref={fileInput} type="file" accept=".json,.dionysus.json,application/json" hidden onChange={e => void importProject(e.target.files?.[0])}/></div></header>
      <section className={editorWorkspace ? "editor-workspace" : "editor-workspace editor-workspace-hidden"}>
        <aside className="editor-tool-rail">
          <div className="editor-mark"><WandSparkles size={20}/></div>
          {[{id:"video",label:"Video",Icon:Film},{id:"text",label:"Text",Icon:Type},{id:"audio",label:"Audio",Icon:Music2},{id:"caption",label:"Caption",Icon:Captions},{id:"image",label:"Image",Icon:Image}].map(({id,label,Icon})=><button key={id} className={editorTool===id?"active":""} onClick={()=>setEditorTool(id as typeof editorTool)}><Icon size={18}/><span>{label}</span></button>)}
          <div className="editor-rail-bottom">V6</div>
        </aside>
        <aside className="editor-inspector">
          <div className="editor-inspector-title">{editorTool==="text"?"Text":editorTool==="video"?"Video":editorTool==="audio"?"Audio":editorTool==="caption"?"Caption":"Image"}</div>
          {editorTool==="text" ? <><div className="editor-text-preview">{selected?.title ?? "Your text"}</div><label>Text<textarea value={selected?.title ?? ""} onChange={e=>selected&&change(p=>({...p,shots:p.shots.map(s=>s.id===selected.id?{...s,title:e.target.value}:s)}), "shot-title:"+selected.id)}/></label><div className="editor-tabs"><button className="active">⚙ Settings</button><button>◈ Style</button></div><div className="editor-settings"><strong>Animations</strong><span>Enter Animation</span><div className="editor-options"><button>None</button><button>Fade</button><button className="active">Slide</button><button>Scale</button></div><span>Exit Animation</span><div className="editor-options"><button>None</button><button className="active">Fade</button><button>Slide</button><button>Scale</button></div><p>Animation preview controls are coming next.</p></div></> : <div className="editor-settings"><strong>{editorTool[0].toUpperCase()+editorTool.slice(1)} settings</strong><p>Select a {editorTool} clip on the timeline to edit its properties.</p></div>}
        </aside>
        <div className="editor-main">
          <header className="editor-topbar"><div className="editor-project-name">{project.name}<span> / Editor</span></div><div className="editor-top-actions"><button title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled={undoStack.length === 0} onClick={undoProjectChange}><Undo2 size={16}/></button><button title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" disabled={redoStack.length === 0} onClick={redoProjectChange}><Redo2 size={16}/></button><button title="Notifications"><Bell size={16}/></button><button className="editor-render" onClick={()=>void exportVideo()}>Render Video</button><button className="editor-exit" onClick={()=>setEditorWorkspace(false)}>Project view</button></div></header>
          <section className="editor-preview-stage"><div className="editor-preview-toolbar"><span><Film size={13}/>Timeline preview · {editorTimeLabel(editorTime)}</span><button type="button" className="button button-quiet button-small" aria-pressed={showPreviewOverlay} onClick={() => setShowPreviewOverlay(value => !value)}>{showPreviewOverlay ? "Hide title" : "Show title"}</button>{previewImage && <button type="button" className="button button-quiet button-small" onClick={() => { setPreviewAssetId("__none__"); setNotice("Preview image cleared."); }}>Clear image</button>}</div><div className="editor-preview-frame"><canvas ref={previewCanvasRef} className="editor-preview-canvas" aria-label={"Timeline preview at " + editorTimeLabel(editorTime)} />{showPreviewOverlay && <div className="editor-preview-art"><div className="editor-preview-kicker">SHOT {String(Math.max(1,(activeShotInfo.index ?? 0)+1)).padStart(2,"0")}</div><div className="editor-preview-title">{activeShotInfo.shot?.title ?? project.name}</div><div className="editor-preview-subtitle">{activeShotInfo.shot?.intent || "No visual layer at this time. Import media and add it to a clip slot to preview it here."}</div></div>}<div className="editor-selection-box"><span/></div></div></section>
          <section className="editor-timeline"><div className="editor-playback"><div><button title="Undo" aria-label="Undo" disabled={undoStack.length === 0} onClick={undoProjectChange}><Undo2 size={15}/></button><button title="Redo" aria-label="Redo" disabled={redoStack.length === 0} onClick={redoProjectChange}><Redo2 size={15}/></button></div><div><button className="play-button" disabled><Play size={14}/></button><strong>{editorTimeLabel(editorTime)}</strong><span>/ {editorTimeLabel(runtime)}</span></div><button title="Timeline settings" onClick={()=>setView("timeline")}><Settings2 size={16}/></button></div><div className="editor-ruler"><div className="editor-track-spacer"/><div className="editor-ruler-marks" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);seekEditorTime(e);}} onPointerMove={e=>{if(e.buttons===1)seekEditorTime(e);}} role="slider" aria-label="Seek timeline" aria-valuemin={0} aria-valuemax={runtime} aria-valuenow={editorTime} tabIndex={0} onKeyDown={e=>{if(e.key==="ArrowRight")setEditorTime(t=>Math.min(runtime,t+0.5));if(e.key==="ArrowLeft")setEditorTime(t=>Math.max(0,t-0.5));}}><div className="editor-playhead-ruler" style={{left:(editorTime/Math.max(runtime,1)*100)+"%"}}/>{Array.from({length:Math.floor(runtime/5)+1},(_,i)=>i*5).concat(runtime%5===0?[]:[runtime]).map(s=><span key={s} style={{left:(s/Math.max(runtime,1)*100)+"%"}}>{time(s)}</span>)}</div></div>
          <div className="editor-track-row"><div className="editor-track-name">Text</div><div className="editor-track-lane"><div className="editor-playhead" style={{left:(editorTime/Math.max(runtime,1)*100)+"%"}}/>{project.shots.map((s,i)=><button key={s.id} draggable onDragStart={e=>e.dataTransfer.setData("text/shot-id",s.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();reorderShots(e.dataTransfer.getData("text/shot-id"),s.id);}} title="Drag to reorder shot" className={"editor-text-clip "+(s.id===selectedId?"selected":"")} style={{left:(project.shots.slice(0,i).reduce((n,x)=>n+x.duration,0)/Math.max(runtime,1)*100)+"%",width:(s.duration/Math.max(runtime,1)*100)+"%"}} onClick={()=>{setSelectedId(s.id);setEditorTime(project.shots.slice(0,i).reduce((n,x)=>n+x.duration,0));}}>{s.title}</button>)}</div></div>
          {project.tracks.map((track)=><div className="editor-track-row" key={track.id}><div className="editor-track-name">{track.kind}</div><div className="editor-track-lane"><div className="editor-playhead" style={{left:(editorTime/Math.max(runtime,1)*100)+"%"}}/>{project.shots.map((s,i)=><button key={s.id} draggable onDragStart={e=>e.dataTransfer.setData("text/shot-id",s.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();reorderShots(e.dataTransfer.getData("text/shot-id"),s.id);}} title="Drag to reorder shot" className={"editor-video-clip "+(s.id===selectedId?"selected":"")} style={{left:(project.shots.slice(0,i).reduce((n,x)=>n+x.duration,0)/Math.max(runtime,1)*100)+"%",width:(s.duration/Math.max(runtime,1)*100)+"%"}} onClick={()=>{setSelectedId(s.id);setEditorTime(project.shots.slice(0,i).reduce((n,x)=>n+x.duration,0));}}><span>{s.title}</span><small>{s.duration}s</small></button>)}</div></div>)}
          <section className="editor-linked-timeline visual-timeline" aria-label="Linked media timeline">
            <div className="editor-linked-heading"><div><strong>Media tracks</strong><span>{project.timelineClips?.length ?? 0} clips · select a block to edit</span></div>
              <button onClick={() => {
                const videoTrack = project.tracks.find(track => track.kind === "video");
                const audioTrack = project.tracks.find(track => track.kind === "audio");
                if (!videoTrack || !audioTrack) { setNotice("Add both a video track and an audio track first."); return; }
                const clipId = id("timeline-video");
                try {
                  change(p => {
                    const result = addVideoClip({ tracks: p.tracks, timelineClips: p.timelineClips ?? [] }, {
                      id: clipId, name: "Video clip " + ((p.timelineClips?.filter(clip => clip.kind === "video").length ?? 0) + 1),
                      trackId: videoTrack.id, start: editorTime, duration: Math.max(1, Math.min(5, runtime - editorTime || 5)),
                      sourceHasAudio: true, audioTrackId: audioTrack.id, audioClipId: id("timeline-audio")
                    });
                    return { ...p, timelineClips: result.timelineClips };
                  });
                  setSelectedTimelineClipId(clipId);
                  setNotice("Added a linked video/audio pair to the visible tracks. Source playback is not implemented yet.");
                } catch (error) { setNotice(error instanceof Error ? error.message : "Could not add timeline clip."); }
              }}><Plus size={14}/> Add linked video/audio</button>
            </div>
            <div className="visual-track-list">
              {project.tracks.filter(track => track.kind === "video" || track.kind === "audio").map(track => {
                const clips = (project.timelineClips ?? []).filter(clip => clip.trackId === track.id);
                const visibleDuration = Math.max(runtime, ...clips.map(clip => clip.start + clip.duration), 10);
                return <div className="visual-track-row" key={track.id}>
                  <div className="visual-track-label"><span className={track.kind === "audio" ? "track-kind-audio" : "track-kind-video"}>{track.kind === "audio" ? <AudioLines size={15}/> : <Film size={15}/>}</span><div><strong>{track.name || (track.kind === "audio" ? "Audio" : "Video")}</strong><small>{track.kind === "audio" ? "Audio lane" : "Video lane"}</small></div></div>
                  <div className="visual-track-lane" style={{ backgroundSize: (5 / visibleDuration * 100) + "% 100%" }}>
                    <div className="visual-playhead" style={{left:(editorTime/visibleDuration*100)+"%"}}/>
                    {clips.map(clip => <button key={clip.id} className={"visual-media-clip " + (clip.kind === "audio" ? "audio-clip" : "video-clip") + (clip.id === selectedTimelineClipId ? " selected" : "")} style={{left:(clip.start/visibleDuration*100)+"%",width:Math.max(2,clip.duration/visibleDuration*100)+"%"}} onClick={()=>setSelectedTimelineClipId(clip.id)} title={clip.name + " · " + clip.start.toFixed(1) + "–" + (clip.start+clip.duration).toFixed(1) + "s"}>
                      <span className="visual-clip-icon">{clip.kind === "audio" ? <AudioLines size={13}/> : <Film size={13}/>}</span><span className="visual-clip-copy"><strong>{clip.name}</strong><small>{clip.duration.toFixed(1)}s{clip.linkedVideoClipId ? " · linked" : clip.kind === "audio" ? " · independent" : ""}</small></span>
                    </button>)}
                    {!clips.length && <span className="visual-track-empty">Drop or add a clip to this lane</span>}
                  </div>
                </div>;
              })}
            </div>
            {(() => {
              const clip = (project.timelineClips ?? []).find(item => item.id === selectedTimelineClipId);
              if (!clip) return <div className="visual-timeline-empty">Select a clip block to inspect timing and link state.</div>;
              return <div className="visual-clip-inspector">
                <div className="visual-clip-inspector-title"><div><strong>{clip.name}</strong><span>{clip.kind} · {clip.linkedVideoClipId ? "linked source audio" : clip.kind === "audio" ? "independent audio" : "video source"}</span></div><button className="button button-quiet button-small" onClick={()=>setSelectedTimelineClipId("")}>Close</button></div>
                <div className="visual-clip-actions">
                  <button onClick={() => { try { change(p => ({ ...p, timelineClips: moveTimelineClip({ tracks: p.tracks, timelineClips: p.timelineClips ?? [] }, clip.id, Math.max(0, clip.start - 0.5)).timelineClips })); } catch (error) { setNotice(error instanceof Error ? error.message : "Move failed."); } }}>−0.5s</button>
                  <button onClick={() => { try { change(p => ({ ...p, timelineClips: moveTimelineClip({ tracks: p.tracks, timelineClips: p.timelineClips ?? [] }, clip.id, clip.start + 0.5).timelineClips })); } catch (error) { setNotice(error instanceof Error ? error.message : "Move failed."); } }}>+0.5s</button>
                  <button onClick={() => { try { change(p => ({ ...p, timelineClips: trimTimelineClip({ tracks: p.tracks, timelineClips: p.timelineClips ?? [] }, clip.id, Math.max(0.1, clip.duration - 0.5)).timelineClips })); } catch (error) { setNotice(error instanceof Error ? error.message : "Trim failed."); } }}>Trim −0.5s</button>
                  {clip.kind === "audio" && clip.linkedVideoClipId ? <button onClick={() => { try { change(p => ({ ...p, timelineClips: unlinkTimelineAudio({ tracks: p.tracks, timelineClips: p.timelineClips ?? [] }, clip.id).timelineClips })); setNotice("Audio unlinked; it can now be edited independently."); } catch (error) { setNotice(error instanceof Error ? error.message : "Unlink failed."); } }}>Unlink audio</button> : null}
                  <button className="danger-action" onClick={() => { change(p => ({ ...p, timelineClips: deleteTimelineClip({ tracks: p.tracks, timelineClips: p.timelineClips ?? [] }, clip.id).timelineClips })); setSelectedTimelineClipId(""); }}>Delete clip</button>
                </div>
                <div className="visual-clip-timing"><span>Start <strong>{clip.start.toFixed(1)}s</strong></span><span>End <strong>{(clip.start+clip.duration).toFixed(1)}s</strong></span><span>Duration <strong>{clip.duration.toFixed(1)}s</strong></span></div><label className="field-label">Source asset<select className="text-field" aria-label={clip.name + " timeline source asset"} value={clip.assetId??""} onChange={e=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id!==clip.id?item:{...item,assetId:e.target.value||undefined})}))}><option value="">No source assigned</option>{project.assets.filter(asset=>asset.kind===clip.kind).map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                <div className="visual-provenance-grid">
                  <label>Source in (s)<input className="text-field" type="number" min="0" step="0.1" value={clip.sourceIn ?? 0} onChange={e => { const value=Math.max(0,Number(e.target.value)||0); change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id!==clip.id?item:{...item,sourceIn:value,sourceOut:Math.max(value+0.1,item.sourceOut??value+item.duration)})})); }}/></label>
                  <label>Source out (s)<input className="text-field" type="number" min={(clip.sourceIn??0)+0.1} step="0.1" value={clip.sourceOut ?? ((clip.sourceIn??0)+clip.duration)} onChange={e => { const value=Math.max((clip.sourceIn??0)+0.1,Number(e.target.value)||0.1); change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id!==clip.id?item:{...item,sourceOut:value,duration:value-(item.sourceIn??0)})})); }}/></label>
                </div>
                <div className="visual-provenance-grid">
                  <label>Generation model<input className="text-field" value={clip.modelName ?? ""} placeholder="e.g. provider/model" onChange={e=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id!==clip.id?item:{...item,modelName:e.target.value})}))}/></label>
                  <label>Model version<input className="text-field" value={clip.modelVersion ?? ""} placeholder="Optional version" onChange={e=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id!==clip.id?item:{...item,modelVersion:e.target.value})}))}/></label>
                </div>
                <label className="visual-prompt-field">Generation prompt<textarea className="text-area" rows={3} value={clip.prompt ?? ""} placeholder="Store the prompt used to generate this source clip" onChange={e=>change(p=>({...p,timelineClips:(p.timelineClips??[]).map(item=>item.id!==clip.id?item:{...item,prompt:e.target.value})}))}/></label>
                <p className="inline-note">Metadata only. In-app generation and source playback are not connected yet.</p>
              </div>;
            })()}
          </section>
          <div className="editor-timeline-footer">Timeline · {project.shots.length} shots · {slotCount} clip slots <button onClick={()=>setEditorWorkspace(false)}>Open full project controls</button></div></section>
        </div>
      </section>
      <div className={editorWorkspace ? "editor-hidden-project" : "page-content"}>
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> {t("heading.eyebrow")}</div><h1>{view === "storyboard" ? t("heading.storyboard.title") : view === "timeline" ? t("heading.timeline.title") : view === "assets" ? t("heading.assets.title") : t("heading.references.title")}</h1><p>{view === "storyboard" ? t("heading.storyboard.description") : view === "timeline" ? t("heading.timeline.description") : view === "assets" ? t("heading.assets.description") : t("heading.references.description")}</p></div><div className="heading-meta"><span className="status-dot"/> {t("status.autosaved")} <span className="meta-divider"/> <span>{t("project.versionFoundation")}</span></div></section>
        <section className="project-overview"><div className="overview-main"><div className="overview-icon"><Clapperboard size={19}/></div><div className="overview-copy"><div className="overview-kicker">{t("project.current")}</div><input className="project-name-input" aria-label={t("project.name")} value={project.name} onChange={e => change(p => ({ ...p, name: e.target.value }))}/><div className="project-subline"><span><Clock3 size={13}/> {t("project.runtimeSummary", { duration: time(runtime) })}</span><span><Film size={13}/> {t("project.shotCount", { count: project.shots.length })}</span><span><Layers3 size={13}/> {t("project.clipSlotCount", { count: slotCount })}</span></div></div></div><div className="project-specs"><div><span>{t("project.canvas")}</span><strong>{project.width} × {project.height}</strong></div><div><span>{t("project.frameRate")}</span><strong>{project.frameRate} FPS</strong></div><button className="icon-button" title={t("project.canvasSettingsPlanned")} onClick={() => setNotice(t("notice.canvasSettingsUnavailable"))}><Settings2 size={17}/></button></div></section>
        <div className="workbench"><section className="workbench-main">
          {view === "storyboard" && <><div className="section-toolbar"><div><h2>{t("storyboard.title")}</h2><p>{t("storyboard.shotCount", { count: project.shots.length })} · SeeDance node flow canvas</p></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={()=>setIsAgentModalOpen(true)}><Sparkles size={14} color="#d5f36a"/> AI Storyboard Plan</button><button className="button button-quiet button-small" onClick={()=>setIsChecklistOpen(true)}><CheckCircle2 size={14} color="#75d7c1"/> Production Guide</button><button className="button button-quiet button-small" onClick={()=>setStoryboardMode(m => m === "flow" ? "list" : "flow")}>{storyboardMode === "flow" ? <Layers3 size={14}/> : <Maximize2 size={14}/>} {storyboardMode === "flow" ? "Grid Cards" : "Node Flow Canvas"}</button><button className="button button-quiet button-small" onClick={syncStoryboardToTimeline}><Film size={14}/> Generate / update timeline</button><button className="button button-primary button-small" onClick={addShot}><Plus size={15}/> {t("action.addShot")}</button></div></div>{storyboardMode === "flow" ? <StoryboardFlowCanvas project={project} selectedShotId={selectedId} onSelectShot={setSelectedId} onUpdateShot={updateShot} onAddShot={addShot} onDeleteShot={removeShot} onDuplicateShot={duplicateShot} onAddConnection={addStoryboardConnection} onRemoveConnection={removeStoryboardConnection} onOpenAgentModal={()=>setIsAgentModalOpen(true)} onOpenChecklist={()=>setIsChecklistOpen(true)} onSyncTimeline={syncStoryboardToTimeline} onAttachAssetToShot={attachAssetToShot} onSelectVersion={(sId, slotId, vId) => { chooseSlotVersion(sId, slotId, vId); setSelectedSlotId(slotId); setView("timeline"); }}/> : <div className="shot-list">{project.shots.map((shot, i) => <article key={shot.id} role="button" tabIndex={0} className={"shot-card " + (selected?.id === shot.id ? "selected" : "")} onClick={() => setSelectedId(shot.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(shot.id); } }}><div className="shot-number">{String(i + 1).padStart(2, "0")}</div><div className="shot-thumb"><div className="thumb-grid"/><div className="thumb-center"><Film size={21}/></div><span>{time(shot.duration)}</span></div><div className="shot-card-body"><div className="shot-title-row"><h3>{shot.title}</h3><span className={"shot-status status-" + shot.status}>{t(("status." + shot.status) as "status.planned" | "status.in-progress" | "status.ready")}</span></div><p>{shot.intent || t("shot.emptyIntent")}</p><div className="shot-card-meta"><span><Layers3 size={13}/> {t("shot.clipSlotCount", { count: shot.slots.length })}</span><span><Clock3 size={13}/> {t("shot.durationTarget", { duration: shot.duration })}</span></div></div><div className="shot-arrow">↗</div><button type="button" className="shot-version-toggle" aria-expanded={expandedVersionShotId === shot.id} onClick={e => { e.stopPropagation(); setExpandedVersionShotId(expandedVersionShotId === shot.id ? "" : shot.id); }}><ChevronDown size={13}/><span>{shot.slots.reduce((n, slot) => n + slot.versions.length, 0)} versions</span></button>{expandedVersionShotId === shot.id && <div className="shot-version-dropdown" onClick={e => e.stopPropagation()}>{shot.slots.flatMap(slot => slot.versions.map((version, vi) => ({slot, version, vi}))).map(({slot,version,vi}) => <button type="button" key={version.id} className={"shot-version-option" + (version.id === slot.selectedVersionId ? " active" : "")} onClick={() => { setSelectedId(shot.id); setSelectedSlotId(slot.id); chooseSlotVersion(shot.id,slot.id,version.id); setView("timeline"); }}><span>{slot.name} · {version.name || "Version " + (vi+1)}</span><small>{version.duration}s · {version.layers.length} layers</small></button>)}</div>}</article>)}<button className="add-shot-card" onClick={addShot}><span><Plus size={17}/></span><strong>{t("shot.addAnother")}</strong><small>{t("shot.addAnotherHint")}</small></button></div>}</>}
          {view === "timeline" && <><div className="section-toolbar"><div><h2>{t("timeline.title")}</h2><p>{t("timeline.description")}</p></div><button className="button button-primary button-small" disabled={!selected} onClick={() => selected && addSlot(selected.id)}><Plus size={15}/> {t("action.addClipSlot")}</button></div><div className="timeline-ruler">{Array.from({ length: Math.floor(runtime / 5) + 1 }, (_, i) => i * 5).concat(runtime % 5 === 0 ? [] : [runtime]).map(seconds => <span key={seconds} style={{ left: (seconds / Math.max(runtime, 1) * 100) + "%" }}>{time(seconds)}</span>)}</div><div className="timeline-scroll">{project.tracks.map((track, i) => <div className="timeline-track" key={track.id}><div className="track-label">{track.kind === "audio" ? <AudioLines size={14}/> : track.kind === "text" ? <Sparkles size={14}/> : <Film size={14}/>}<span>{t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects")}</span></div><div className="track-lane" style={{ backgroundSize: (5 / Math.max(runtime, 1) * 100) + "% 100%" }}>{i === 0 && project.shots.map((shot, si) => <button key={shot.id} className={"timeline-shot " + (selected?.id === shot.id ? "chosen" : "")} style={{ left: (project.shots.slice(0, si).reduce((n, s) => n + s.duration, 0) / Math.max(runtime, 1) * 100) + "%", width: (shot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => setSelectedId(shot.id)}><span>{shot.title}</span><small>{shot.duration}s</small></button>)}{i === 1 && selected?.slots.map(slot => <button key={slot.id} className="timeline-slot" style={{ left: ((selectedStart + slot.start) / Math.max(runtime, 1) * 100) + "%", width: (slot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => selectClipSlot(slot.id)}><span>{slot.name}</span><small>{slot.versions.find(v => v.id === slot.selectedVersionId)?.name ?? "No version"}</small></button>)}{i > 1 && <div className="track-empty"><span>+</span> {t("timeline.trackAddLayer", { kind: t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects") })}</div>}</div></div>)}</div>{selected && (() => { const activeSlot = selected.slots.find(slot => slot.id === selectedSlotId); if (!activeSlot) return null; const activeVersion = activeSlot.versions.find(version => version.id === activeSlot.selectedVersionId); return <section className="version-panel"><div className="version-panel-heading"><div><span className="inspector-kicker">CLIP SLOT</span><label className="field-label">Clip slot name<input className="text-field" aria-label="Clip slot name" value={activeSlot.name} onChange={e => updateSlotName(selected.id, activeSlot.id, e.target.value)} /></label><p>{activeSlot.duration}s · {activeSlot.versions.length} version{activeSlot.versions.length === 1 ? "" : "s"}</p></div><button className="button button-quiet button-small" onClick={() => setSelectedSlotId("")}>Close</button></div><div className="slot-timing-controls">
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
                      <div className="nested-module-title"><strong>{layer.name}</strong><span>{layer.kind}</span></div><div className="visual-provenance-grid">
                        <label>Layer type<select className="text-field" aria-label={layer.name + " layer type"} value={layer.kind} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{kind:e.target.value as CompositionLayer["kind"],assetId:undefined})}><option value="video">Video</option><option value="image">Image</option><option value="audio">Audio</option><option value="text">Text</option><option value="composition">Composition placeholder</option><option value="script">Script</option></select></label>
                        <label>Source asset<select className="text-field" aria-label={layer.name + " source asset"} value={layer.assetId??""} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{assetId:e.target.value||undefined})}><option value="">No source assigned</option>{project.assets.filter(asset=>layer.kind==="video"?asset.kind==="video":layer.kind==="image"?asset.kind==="image":layer.kind==="audio"?asset.kind==="audio":false).map(asset=><option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
                      </div><div className="composition-frame-controls"><label>Fit mode<select className="text-field" aria-label={layer.name + " fit mode"} value={layer.fitMode ?? "contain"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{fitMode:e.target.value as CompositionLayer["fitMode"]})}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label><label>X (%)<input className="text-field" type="number" value={layer.x ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{x:Number(e.target.value)||0})}/></label><label>Y (%)<input className="text-field" type="number" value={layer.y ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{y:Number(e.target.value)||0})}/></label><label>Width (%)<input className="text-field" type="number" min="1" max="100" value={layer.width ?? 100} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{width:Math.max(1,Math.min(100,Number(e.target.value)||1))})}/></label><label>Height (%)<input className="text-field" type="number" min="1" max="100" value={layer.height ?? 100} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{height:Math.max(1,Math.min(100,Number(e.target.value)||1))})}/></label><label>Frame shape<select className="text-field" value={layer.shape ?? "rectangle"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{shape:e.target.value as CompositionLayer["shape"]})}><option value="rectangle">Rectangle</option><option value="rounded">Rounded</option><option value="circle">Circle</option></select></label><label>Background<input className="text-field" type="color" value={layer.backgroundColor ?? "#111113"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{backgroundColor:e.target.value})}/></label><label>Border color<input className="text-field" type="color" value={layer.borderColor ?? "#000000"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{borderColor:e.target.value})}/></label><label>Border width (px)<input className="text-field" type="number" min="0" value={layer.borderWidth ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{borderWidth:Math.max(0,Number(e.target.value)||0)})}/></label><label>Corner radius (px)<input className="text-field" type="number" min="0" value={layer.cornerRadius ?? 0} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{cornerRadius:Math.max(0,Number(e.target.value)||0)})}/></label><label>Scale<input className="text-field" type="number" min="0.01" step="0.1" value={layer.scale ?? 1} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{scale:Math.max(0.01,Number(e.target.value)||0.01)})}/></label><label>Opacity<input className="text-field" type="number" min="0" max="1" step="0.05" value={layer.opacity ?? 1} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{opacity:Math.max(0,Math.min(1,Number(e.target.value)||0))})}/></label><label>Animation<select className="text-field" aria-label={layer.name + " animation"} value={layer.animation ?? "none"} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{animation:e.target.value as CompositionLayer["animation"]})}><option value="none">None</option><option value="float">Float</option><option value="pulse">Pulse</option><option value="rotate">Rotate</option></select></label><label>Animation duration (s)<input className="text-field" type="number" min="0.1" max="60" step="0.1" value={layer.animationDuration ?? 3} onChange={e=>updateCompositionLayer(selected.id,activeSlot.id,activeVersion.id,layer.id,{animationDuration:Math.max(0.1,Math.min(60,Number(e.target.value)||3))})}/></label></div>
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
                        const path=await storeMediaAsset(assetId,blob);
                        const current=projectRef.current;
                        const shot=current.shots.find(item=>item.id===selected.id);
                        const references=shot?current.referenceProfiles.filter(profile=>shot.referenceProfileIds.includes(profile.id)).flatMap(profile=>profile.references).filter(reference=>!shot.referenceOverrides.some(override=>override.referenceId===reference.id&&override.action==="exclude")).map(reference=>{const override=shot.referenceOverrides.find(item=>item.referenceId===reference.id&&item.action==="replace");return override?.replacementAssetId?{...reference,assetId:override.replacementAssetId}:{...reference};}):[];
                        const record={id:id("generation"),createdAt:new Date().toISOString(),prompt,referenceSnapshot:references,modelName:model,outputAssetId:assetId};
                        change(p=>({...p,assets:[...p.assets,{id:assetId,name:layer.name+" generated",kind:"image",path,prompt,modelName:model}],shots:p.shots.map(item=>item.id!==selected.id?item:{...item,slots:item.slots.map(slot=>slot.id!==activeSlot.id?slot:{...slot,versions:slot.versions.map(version=>version.id!==activeVersion.id?version:{...version,layers:version.layers.map(item=>item.id!==layer.id?item:{...item,kind:"image",assetId,prompt,modelName:model}),generationRecords:[...version.generationRecords,record]})})})}));
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
          {view === "assets" && <><div className="section-toolbar"><div><h2>{t("assets.title")}</h2><p>{t("assets.description")}</p></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={() => assetFileInput.current?.click()}><Upload size={14}/> {t("asset.actionImport")}</button><button className="button button-primary button-small" onClick={() => setShowAssetForm(v => !v)}><Plus size={15}/> {t("asset.actionAdd")}</button></div><input ref={assetFileInput} type="file" accept="video/*,image/*,audio/*,.js,.mjs,.ts,.html" hidden onChange={e => importAssetFile(e.target.files?.[0])}/></div>{showAssetForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addAsset(assetDraftName, assetDraftKind, assetDraftNotes); }}><label className="field-label">{t("asset.nameLabel")}<input className="text-field" value={assetDraftName} onChange={e => setAssetDraftName(e.target.value)} placeholder={t("asset.namePlaceholder")} required/></label><label className="field-label">{t("asset.kindLabel")}<select className="text-field" value={assetDraftKind} onChange={e => setAssetDraftKind(e.target.value as AssetKind)}>{(["video","image","audio","script","other"] as AssetKind[]).map(kind => <option key={kind} value={kind}>{t(("media."+kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</option>)}</select></label><label className="field-label">{t("asset.notesLabel")}<input className="text-field" value={assetDraftNotes} onChange={e => setAssetDraftNotes(e.target.value)} placeholder={t("asset.notesPlaceholder")}/></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.save")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowAssetForm(false)}>{t("action.cancel")}</button></div></form>}{project.assets.length === 0 ? <div className="empty-state"><div className="empty-icon"><Film size={23}/></div><h3>{t("assets.emptyTitle")}</h3><p>{t("assets.emptyDescription")}</p></div> : <div className="asset-grid">{project.assets.map(a => <article className="asset-card" key={a.id}><div className="asset-card-head"><Film size={19}/><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeAsset(a.id)}>×</button></div><input className="text-field asset-name-field" aria-label={t("asset.nameLabel")} value={a.name} onChange={e => updateAsset(a.id, { name: e.target.value })}/><span>{t(("media." + a.kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</span>{a.kind === "image" && a.path?.startsWith("data:image/") && <button type="button" className="button button-quiet button-small" aria-pressed={previewAssetId === a.id} onClick={() => { setPreviewAssetId(a.id); setEditorWorkspace(true); setNotice("Preview image selected: " + a.name); }}>Preview in editor</button>}{a.path && <small className="asset-path">{a.path.startsWith("data:image/") ? "Image stored locally for preview" : a.path}</small>}<input className="text-field asset-notes-field" aria-label={t("asset.notesLabel")} value={a.notes ?? ""} placeholder={t("asset.notesPlaceholder")} onChange={e => updateAsset(a.id, { notes: e.target.value })}/><input className="text-field" aria-label="Asset generation prompt" value={a.prompt??""} placeholder="Generation prompt" onChange={e=>updateAsset(a.id,{prompt:e.target.value})}/><input className="text-field" aria-label="Asset generation model" value={a.modelName??""} placeholder="Generation model" onChange={e=>updateAsset(a.id,{modelName:e.target.value})}/><input className="text-field" aria-label="Asset model version" value={a.modelVersion??""} placeholder="Model version" onChange={e=>updateAsset(a.id,{modelVersion:e.target.value})}/></article>)}</div>}<p className="inline-note"><CircleHelp size={13}/>{t("assets.importMetadataOnly")}</p></>}
          {view === "references" && <><div className="section-toolbar"><div><h2>{t("references.title")}</h2><p>{t("references.description")}</p></div><button className="button button-primary button-small" onClick={() => setShowProfileForm(v => !v)}><Plus size={15}/> {t("references.actionNewProfile")}</button></div>{showProfileForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addReferenceProfile(); }}><label className="field-label">{t("profile.nameLabel")}<input className="text-field" value={profileDraftName} onChange={e => setProfileDraftName(e.target.value)} placeholder={t("profile.namePlaceholder")} required/></label><label className="field-label">{t("profile.typeLabel")}<select className="text-field" value={profileDraftType} onChange={e => setProfileDraftType(e.target.value as ReferenceProfile["entityType"])}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.createProfile")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowProfileForm(false)}>{t("action.cancel")}</button></div></form>}{project.referenceProfiles.length === 0 ? <div className="empty-state"><div className="empty-icon"><Sparkles size={23}/></div><h3>{t("references.emptyTitle")}</h3><p>{t("references.emptyDescription")}</p><div className="reference-example"><span className="ref-chip">{t("reference.identity")}</span><span className="ref-chip">{t("reference.face")}</span><span className="ref-chip">{t("reference.outfit")}</span><span className="ref-chip">{t("reference.lighting")}</span></div></div> : <div className="profile-list">{project.referenceProfiles.map(profile => <article className="profile-card profile-card-expanded" key={profile.id}><div className="profile-heading"><Sparkles size={18}/><input className="text-field profile-name-field" aria-label={t("profile.nameLabel")} value={profile.name} onChange={e => updateReferenceProfile(profile.id, { name: e.target.value })}/><select className="text-field profile-type-field" aria-label={t("profile.typeLabel")} value={profile.entityType} onChange={e => updateReferenceProfile(profile.id, { entityType: e.target.value as ReferenceProfile["entityType"] })}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeReferenceProfile(profile.id)}>×</button></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={() => createStoryboardFromReference(profile.id)}>Create storyboard draft from references</button></div><div className="profile-reference-list">{profile.references.length ? profile.references.map(reference => { const asset = project.assets.find(a => a.id === reference.assetId); return <div className="profile-reference-row" key={reference.id}><span className="profile-reference-name">{asset?.name ?? t("references.missingAsset")}</span><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={reference.role} onChange={e => updateProfileReferenceRole(profile.id, reference.id, e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.remove")} onClick={() => removeProfileReference(profile.id, reference.id)}>×</button></div>; }) : <p className="muted-inline">{t("references.noReferences")}</p>}</div><form className="profile-add-reference" onSubmit={e => { e.preventDefault(); addProfileReference(profile.id); }}><select className="text-field" aria-label={t("references.chooseAsset")} value={referenceAssetId} onChange={e => setReferenceAssetId(e.target.value)}><option value="">{t("references.chooseAsset")}</option>{project.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={referenceRole} onChange={e => setReferenceRole(e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button type="submit" className="button button-quiet button-small" disabled={project.assets.length===0}>{t("references.actionAddReference")}</button></form></article>)}</div>}</>}
        </section>
        <aside className="inspector"><div className="inspector-header"><div><span className="inspector-kicker">{t("inspector.title")}</span><h2>{selected ? t("inspector.shotDetails") : t("inspector.projectDetails")}</h2></div><Settings2 size={17}/></div>{selected ? <div className="inspector-content"><div className="inline-actions"><button className="button button-quiet button-small" disabled={!selected} title="Create an independent copy of this shot" onClick={() => selected && duplicateShot(selected.id)}>Duplicate shot</button><button className="button button-quiet button-small danger-action" disabled={project.shots.length <= 1} title={project.shots.length <= 1 ? "A project must keep at least one shot" : "Delete selected shot"} onClick={() => selected && removeShot(selected.id)}>Delete shot</button></div><label className="field-label">{t("inspector.shotTitle")}</label><input className="text-field" value={selected.title} onChange={e => updateShot(selected.id, { title: e.target.value })}/><label className="field-label">{t("inspector.storyIntent")}</label><textarea className="text-area" placeholder={t("inspector.intentPlaceholder")} value={selected.intent} onChange={e => updateShot(selected.id, { intent: e.target.value })} rows={4}/><div className="field-row"><div><label className="field-label">{t("inspector.targetDuration")}</label><div className="number-field"><input type="number" min={1} max={600} value={selected.duration} onChange={e => updateShot(selected.id, { duration: Math.max(1, Number(e.target.value) || 1) })}/><span>{t("inspector.secondsShort")}</span></div></div><div><label className="field-label">{t("inspector.status")}</label><select className="text-field" value={selected.status} onChange={e => updateShot(selected.id, { status: e.target.value as Shot["status"] })}><option value="planned">{t("status.planned")}</option><option value="in-progress">{t("status.in-progress")}</option><option value="ready">{t("status.ready")}</option></select></div></div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.clipSlots")}</span><span className="small-count">{selected.slots.length}</span></div><div className="slot-inspector-list">{selected.slots.map(slot => <div className={"slot-inspector " + (selectedSlotId === slot.id ? "selected" : "")} key={slot.id}><div className="slot-icon"><SquarePlay size={16}/></div><button type="button" className="slot-copy slot-select-button" aria-pressed={selectedSlotId === slot.id} onClick={() => { selectClipSlot(slot.id); setEditorTime(Math.min(runtime, selectedStart + slot.start)); }}><strong>{slot.name}</strong><span>{t("slot.versionCount", { duration: slot.duration, count: slot.versions.length })}</span></button><button className="mini-menu" title="Duplicate clip slot" aria-label={"Duplicate clip slot " + slot.name} onClick={() => duplicateSlot(selected.id, slot.id)}>⧉</button><button className="mini-menu danger-action" disabled={selected.slots.length <= 1} title={selected.slots.length <= 1 ? "A shot must keep at least one clip slot" : "Delete clip slot"} onClick={() => removeSlot(selected.id, slot.id)}>×</button></div>)}</div><button className="add-slot-button" onClick={() => addSlot(selected.id)}><Plus size={14}/> {t("action.addClipSlot")}</button><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("shot.references")}</span><span className="small-count">{selected.referenceProfileIds.length}</span></div><div className="shot-reference-list">{project.referenceProfiles.length ? project.referenceProfiles.map(profile => <div className="shot-reference-profile" key={profile.id}><label className="shot-reference-option"><input type="checkbox" checked={selected.referenceProfileIds.includes(profile.id)} onChange={e => toggleShotReferenceProfile(selected.id, profile.id, e.target.checked)}/><span>{profile.name}<small>{t("profile.referencesCount", { count: profile.references.length })}</small></span></label>{selected.referenceProfileIds.includes(profile.id) && profile.references.map(reference => { const asset = project.assets.find(item => item.id === reference.assetId); const override = selected.referenceOverrides.find(item => item.referenceId === reference.id); const replacements = project.assets.filter(item => item.id !== reference.assetId); return <div className="shot-reference-override" key={reference.id}><span>{asset?.name ?? t("references.missingAsset")}<small>{t(("referenceRole."+reference.role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</small></span><select className="text-field override-action" aria-label={t("shot.referenceOverride")} value={override?.action ?? "inherit"} onChange={e => updateShotReferenceOverride(selected.id, reference.id, e.target.value as "inherit" | "exclude" | "replace")}><option value="inherit">{t("referenceOverride.inherit")}</option><option value="exclude">{t("referenceOverride.exclude")}</option><option value="replace" disabled={replacements.length === 0}>{t("referenceOverride.replace")}</option></select>{override?.action === "replace" && <select className="text-field override-asset" aria-label={t("referenceOverride.replacementAsset")} value={override.replacementAssetId ?? ""} onChange={e => updateShotReferenceOverride(selected.id, reference.id, "replace", e.target.value)}>{replacements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>; })}</div>) : <p className="muted-inline">{t("shot.noReferenceProfiles")}</p>}</div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.aiPlanning")}</span><Sparkles size={14}/></div><div className="ai-hint"><WandSparkles size={16}/><p>{t("inspector.aiHint")}</p></div></div> : <div className="empty-inspector">{t("inspector.empty")}</div>}</aside></div>
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
        setEditorWorkspace(true);
      }}
    />
  </div>;
}
