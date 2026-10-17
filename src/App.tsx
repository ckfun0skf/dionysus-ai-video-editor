import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, ChevronDown, CircleHelp, Clapperboard, Clock3, Download, FileJson, Film, FolderOpen, Layers3, Plus, Save, Settings2, ShieldCheck, Sparkles, SquarePlay, Upload, WandSparkles, Type, Music2, Captions, Image, Play, Bell, Undo2, Redo2 } from "lucide-react";
import { sampleProject } from "./sampleProject";
import type { Asset, AssetKind, DionysusProject, ReferenceProfile, ReferenceRole, Shot } from "./types";
import { validateProject } from "./projectValidation";
import { t } from "./i18n";
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
  const lastHistoryGroup = useRef("");
  const lastHistoryAt = useRef(0);
  const [view, setView] = useState<View>("storyboard");
  const [editorWorkspace, setEditorWorkspace] = useState(true);
  const [editorTool, setEditorTool] = useState<"video" | "text" | "audio" | "caption" | "image">("text");
  const [editorTime, setEditorTime] = useState(0);
  const [previewAssetId, setPreviewAssetId] = useState("");
  const [showPreviewOverlay, setShowPreviewOverlay] = useState(true);
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
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...project, updatedAt: new Date().toISOString() })); }
    catch { setNotice(t("notice.storageFull")); }
  }, [project]);
  useEffect(() => {
    function handleHistoryShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      event.preventDefault();
      if (event.shiftKey) redoProjectChange();
      else undoProjectChange();
    }
    window.addEventListener("keydown", handleHistoryShortcut);
    return () => window.removeEventListener("keydown", handleHistoryShortcut);
  }, [undoStack, redoStack, project]);
  const selected = project.shots.find(s => s.id === selectedId) ?? project.shots[0];
  const runtime = useMemo(() => project.shots.reduce((n, s) => n + s.duration, 0), [project.shots]);
  const selectedStart = useMemo(() => { const index = project.shots.findIndex(s => s.id === selectedId); return project.shots.slice(0, Math.max(index, 0)).reduce((n, s) => n + s.duration, 0); }, [project.shots, selectedId]);
  const slotCount = project.shots.reduce((n, s) => n + s.slots.length, 0);
  function change(fn: (p: DionysusProject) => DionysusProject, historyGroup = "") {
    const now = Date.now();
    const coalesce = Boolean(historyGroup) && historyGroup === lastHistoryGroup.current && now - lastHistoryAt.current < 800;
    if (!coalesce) setUndoStack(stack => [...stack.slice(-49), copy(project)]);
    lastHistoryGroup.current = historyGroup;
    lastHistoryAt.current = now;
    setRedoStack([]);
    setProject(p => ({ ...fn(p), updatedAt: new Date().toISOString() }));
  }
  function undoProjectChange() {
    if (!undoStack.length) return;
    lastHistoryGroup.current = "";
    setRedoStack(stack => [...stack, copy(project)]);
    setProject({ ...copy(undoStack[undoStack.length - 1]), updatedAt: new Date().toISOString() });
    setUndoStack(stack => stack.slice(0, -1));
    setNotice("Last project change undone.");
  }
  function redoProjectChange() {
    if (!redoStack.length) return;
    lastHistoryGroup.current = "";
    setUndoStack(stack => [...stack, copy(project)]);
    setProject({ ...copy(redoStack[redoStack.length - 1]), updatedAt: new Date().toISOString() });
    setRedoStack(stack => stack.slice(0, -1));
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
    setSelectedSlotId("");
    setNotice("Shot duplicated with independent clip slots and versions.");
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
    change(p => ({ ...p, shots: p.shots.map(item => item.id !== shotId ? item : {
      ...item,
      slots: [...item.slots, duplicate],
    }) }));
    setSelectedSlotId(duplicate.id);
    setNotice("Clip slot duplicated with independent versions. Use Undo to reverse.");
  }

  function updateShot(shotId: string, patch: Partial<Shot>) { const textField = "title" in patch ? "shot-title:" + shotId : "intent" in patch ? "shot-intent:" + shotId : ""; change(p => ({ ...p, shots: p.shots.map(s => s.id === shotId ? { ...s, ...patch } : s) }), textField); }
  function reorderShots(draggedId: string, targetId: string) { if (draggedId === targetId) return; change(p => { const shots = [...p.shots]; const from = shots.findIndex(s => s.id === draggedId); const to = shots.findIndex(s => s.id === targetId); if (from < 0 || to < 0) return p; const [moved] = shots.splice(from, 1); shots.splice(to, 0, moved); const selectedStart = shots.slice(0, Math.max(0, shots.findIndex(s => s.id === selectedId))).reduce((sum, shot) => sum + shot.duration, 0); setEditorTime(selectedStart); return { ...p, shots }; }); }
  function selectClipSlot(slotId: string) { setSelectedSlotId(slotId); }
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
    if (usedByProfile || usedByLayer || usedByOverride) { setNotice(t("notice.assetInUse")); return; }
    change(p => ({ ...p, assets: p.assets.filter(a => a.id !== assetId) }));
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
      <header className="topbar"><div className="breadcrumbs"><span>{t("breadcrumb.projects")}</span><span className="crumb-sep">/</span><strong>{project.name}</strong><span className="local-pill"><span/> {t("status.localBadge")}</span></div><div className="top-actions"><button className="button button-quiet" onClick={() => fileInput.current?.click()}><FolderOpen size={15}/> {t("action.openProject")}</button><button className="button button-quiet" onClick={exportProject}><Save size={15}/> {t("action.exportProject")}</button><button className="button button-primary" onClick={exportPlan}><Download size={15}/> {t("action.exportPlan")}</button><input ref={fileInput} type="file" accept=".json,.dionysus.json,application/json" hidden onChange={e => void importProject(e.target.files?.[0])}/></div></header>
      {editorWorkspace ? <section className="editor-workspace">
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
          <header className="editor-topbar"><div className="editor-project-name">{project.name}<span> / Editor</span></div><div className="editor-top-actions"><button title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled={undoStack.length === 0} onClick={undoProjectChange}><Undo2 size={16}/></button><button title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" disabled={redoStack.length === 0} onClick={redoProjectChange}><Redo2 size={16}/></button><button title="Notifications"><Bell size={16}/></button><button className="editor-render" onClick={()=>setNotice("Video rendering is not implemented yet.")}>Render Video</button><button className="editor-exit" onClick={()=>setEditorWorkspace(false)}>Project view</button></div></header>
          <section className="editor-preview-stage">{previewImage && <div className="editor-preview-toolbar"><span title={previewImage.name}><Image size={13}/>{previewImage.name}</span><button type="button" className="button button-quiet button-small" aria-pressed={showPreviewOverlay} onClick={() => setShowPreviewOverlay(value => !value)}>{showPreviewOverlay ? "Hide title" : "Show title"}</button><button type="button" className="button button-quiet button-small" onClick={() => { setPreviewAssetId("__none__"); setNotice("Preview image cleared."); }}>Clear image</button></div>}<div className="editor-preview-frame">{previewImage ? <img className="editor-preview-image" src={previewImage.path} alt={previewImage.name}/> : null}{showPreviewOverlay && <div className="editor-preview-art"><div className="editor-preview-kicker">SHOT {String(Math.max(1,project.shots.findIndex(s=>s.id===selectedId)+1)).padStart(2,"0")}</div><div className="editor-preview-title">{selected?.title ?? project.name}</div><div className="editor-preview-subtitle">{selected?.intent || "Import an image to preview it behind your title"}</div></div>}<div className="editor-selection-box"><span/></div></div></section>
          <section className="editor-timeline"><div className="editor-playback"><div><button title="Undo" aria-label="Undo" disabled={undoStack.length === 0} onClick={undoProjectChange}><Undo2 size={15}/></button><button title="Redo" aria-label="Redo" disabled={redoStack.length === 0} onClick={redoProjectChange}><Redo2 size={15}/></button></div><div><button className="play-button" disabled><Play size={14}/></button><strong>{editorTimeLabel(editorTime)}</strong><span>/ {editorTimeLabel(runtime)}</span></div><button title="Timeline settings" onClick={()=>setView("timeline")}><Settings2 size={16}/></button></div><div className="editor-ruler"><div className="editor-track-spacer"/><div className="editor-ruler-marks" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);seekEditorTime(e);}} onPointerMove={e=>{if(e.buttons===1)seekEditorTime(e);}} role="slider" aria-label="Seek timeline" aria-valuemin={0} aria-valuemax={runtime} aria-valuenow={editorTime} tabIndex={0} onKeyDown={e=>{if(e.key==="ArrowRight")setEditorTime(t=>Math.min(runtime,t+0.5));if(e.key==="ArrowLeft")setEditorTime(t=>Math.max(0,t-0.5));}}><div className="editor-playhead-ruler" style={{left:(editorTime/Math.max(runtime,1)*100)+"%"}}/>{Array.from({length:Math.floor(runtime/5)+1},(_,i)=>i*5).concat(runtime%5===0?[]:[runtime]).map(s=><span key={s} style={{left:(s/Math.max(runtime,1)*100)+"%"}}>{time(s)}</span>)}</div></div>
          <div className="editor-track-row"><div className="editor-track-name">Text</div><div className="editor-track-lane"><div className="editor-playhead" style={{left:(editorTime/Math.max(runtime,1)*100)+"%"}}/>{project.shots.map((s,i)=><button key={s.id} draggable onDragStart={e=>e.dataTransfer.setData("text/shot-id",s.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();reorderShots(e.dataTransfer.getData("text/shot-id"),s.id);}} title="Drag to reorder shot" className={"editor-text-clip "+(s.id===selectedId?"selected":"")} style={{left:(project.shots.slice(0,i).reduce((n,x)=>n+x.duration,0)/Math.max(runtime,1)*100)+"%",width:(s.duration/Math.max(runtime,1)*100)+"%"}} onClick={()=>{setSelectedId(s.id);setEditorTime(project.shots.slice(0,i).reduce((n,x)=>n+x.duration,0));}}>{s.title}</button>)}</div></div>
          {project.tracks.map((track)=><div className="editor-track-row" key={track.id}><div className="editor-track-name">{track.kind}</div><div className="editor-track-lane"><div className="editor-playhead" style={{left:(editorTime/Math.max(runtime,1)*100)+"%"}}/>{project.shots.map((s,i)=><button key={s.id} draggable onDragStart={e=>e.dataTransfer.setData("text/shot-id",s.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();reorderShots(e.dataTransfer.getData("text/shot-id"),s.id);}} title="Drag to reorder shot" className={"editor-video-clip "+(s.id===selectedId?"selected":"")} style={{left:(project.shots.slice(0,i).reduce((n,x)=>n+x.duration,0)/Math.max(runtime,1)*100)+"%",width:(s.duration/Math.max(runtime,1)*100)+"%"}} onClick={()=>{setSelectedId(s.id);setEditorTime(project.shots.slice(0,i).reduce((n,x)=>n+x.duration,0));}}><span>{s.title}</span><small>{s.duration}s</small></button>)}</div></div>)}
          <div className="editor-timeline-footer">Timeline · {project.shots.length} shots · {slotCount} clip slots <button onClick={()=>setEditorWorkspace(false)}>Open full project controls</button></div></section>
        </div>
      </section> : null}
      <div className={editorWorkspace ? "editor-hidden-project" : "page-content"}>
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> {t("heading.eyebrow")}</div><h1>{view === "storyboard" ? t("heading.storyboard.title") : view === "timeline" ? t("heading.timeline.title") : view === "assets" ? t("heading.assets.title") : t("heading.references.title")}</h1><p>{view === "storyboard" ? t("heading.storyboard.description") : view === "timeline" ? t("heading.timeline.description") : view === "assets" ? t("heading.assets.description") : t("heading.references.description")}</p></div><div className="heading-meta"><span className="status-dot"/> {t("status.autosaved")} <span className="meta-divider"/> <span>{t("project.versionFoundation")}</span></div></section>
        <section className="project-overview"><div className="overview-main"><div className="overview-icon"><Clapperboard size={19}/></div><div className="overview-copy"><div className="overview-kicker">{t("project.current")}</div><input className="project-name-input" aria-label={t("project.name")} value={project.name} onChange={e => change(p => ({ ...p, name: e.target.value }))}/><div className="project-subline"><span><Clock3 size={13}/> {t("project.runtimeSummary", { duration: time(runtime) })}</span><span><Film size={13}/> {t("project.shotCount", { count: project.shots.length })}</span><span><Layers3 size={13}/> {t("project.clipSlotCount", { count: slotCount })}</span></div></div></div><div className="project-specs"><div><span>{t("project.canvas")}</span><strong>{project.width} × {project.height}</strong></div><div><span>{t("project.frameRate")}</span><strong>{project.frameRate} FPS</strong></div><button className="icon-button" title={t("project.canvasSettingsPlanned")} onClick={() => setNotice(t("notice.canvasSettingsUnavailable"))}><Settings2 size={17}/></button></div></section>
        <div className="workbench"><section className="workbench-main">
          {view === "storyboard" && <><div className="section-toolbar"><div><h2>{t("storyboard.title")}</h2><p>{t("storyboard.shotCount", { count: project.shots.length })}</p></div><button className="button button-primary button-small" onClick={addShot}><Plus size={15}/> {t("action.addShot")}</button></div><div className="shot-list">{project.shots.map((shot, i) => <button key={shot.id} className={"shot-card " + (selected?.id === shot.id ? "selected" : "")} onClick={() => setSelectedId(shot.id)}><div className="shot-number">{String(i + 1).padStart(2, "0")}</div><div className="shot-thumb"><div className="thumb-grid"/><div className="thumb-center"><Film size={21}/></div><span>{time(shot.duration)}</span></div><div className="shot-card-body"><div className="shot-title-row"><h3>{shot.title}</h3><span className={"shot-status status-" + shot.status}>{t(("status." + shot.status) as "status.planned" | "status.in-progress" | "status.ready")}</span></div><p>{shot.intent || t("shot.emptyIntent")}</p><div className="shot-card-meta"><span><Layers3 size={13}/> {t("shot.clipSlotCount", { count: shot.slots.length })}</span><span><Clock3 size={13}/> {t("shot.durationTarget", { duration: shot.duration })}</span></div></div><div className="shot-arrow">↗</div></button>)}<button className="add-shot-card" onClick={addShot}><span><Plus size={17}/></span><strong>{t("shot.addAnother")}</strong><small>{t("shot.addAnotherHint")}</small></button></div></>}
          {view === "timeline" && <><div className="section-toolbar"><div><h2>{t("timeline.title")}</h2><p>{t("timeline.description")}</p></div><button className="button button-primary button-small" disabled={!selected} onClick={() => selected && addSlot(selected.id)}><Plus size={15}/> {t("action.addClipSlot")}</button></div><div className="timeline-ruler">{Array.from({ length: Math.floor(runtime / 5) + 1 }, (_, i) => i * 5).concat(runtime % 5 === 0 ? [] : [runtime]).map(seconds => <span key={seconds} style={{ left: (seconds / Math.max(runtime, 1) * 100) + "%" }}>{time(seconds)}</span>)}</div><div className="timeline-scroll">{project.tracks.map((track, i) => <div className="timeline-track" key={track.id}><div className="track-label">{track.kind === "audio" ? <AudioLines size={14}/> : track.kind === "text" ? <Sparkles size={14}/> : <Film size={14}/>}<span>{t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects")}</span></div><div className="track-lane" style={{ backgroundSize: (5 / Math.max(runtime, 1) * 100) + "% 100%" }}>{i === 0 && project.shots.map((shot, si) => <button key={shot.id} className={"timeline-shot " + (selected?.id === shot.id ? "chosen" : "")} style={{ left: (project.shots.slice(0, si).reduce((n, s) => n + s.duration, 0) / Math.max(runtime, 1) * 100) + "%", width: (shot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => setSelectedId(shot.id)}><span>{shot.title}</span><small>{shot.duration}s</small></button>)}{i === 1 && selected?.slots.map(slot => <button key={slot.id} className="timeline-slot" style={{ left: ((selectedStart + slot.start) / Math.max(runtime, 1) * 100) + "%", width: (slot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => selectClipSlot(slot.id)}><span>{slot.name}</span><small>{slot.versions.find(v => v.id === slot.selectedVersionId)?.name ?? "No version"}</small></button>)}{i > 1 && <div className="track-empty"><span>+</span> {t("timeline.trackAddLayer", { kind: t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects") })}</div>}</div></div>)}</div>{selected && (() => { const activeSlot = selected.slots.find(slot => slot.id === selectedSlotId); if (!activeSlot) return null; const activeVersion = activeSlot.versions.find(version => version.id === activeSlot.selectedVersionId); return <section className="version-panel"><div className="version-panel-heading"><div><span className="inspector-kicker">CLIP SLOT</span><label className="field-label">Clip slot name<input className="text-field" aria-label="Clip slot name" value={activeSlot.name} onChange={e => updateSlotName(selected.id, activeSlot.id, e.target.value)} /></label><p>{activeSlot.duration}s · {activeSlot.versions.length} version{activeSlot.versions.length === 1 ? "" : "s"}</p></div><button className="button button-quiet button-small" onClick={() => setSelectedSlotId("")}>Close</button></div><div className="slot-timing-controls">
  <div className="timing-field"><label className="field-label">Start time (seconds)<input className="text-field" type="number" min="0" step="0.1" value={activeSlot.start} onChange={e => updateSlotTiming(selected.id, activeSlot.id, "start", Number(e.target.value))}/></label><div className="timing-nudges"><button type="button" aria-label="Move start earlier by 0.5 seconds" onClick={() => updateSlotTiming(selected.id, activeSlot.id, "start", activeSlot.start - 0.5)}>−0.5s</button><button type="button" aria-label="Move start later by 0.5 seconds" onClick={() => updateSlotTiming(selected.id, activeSlot.id, "start", activeSlot.start + 0.5)}>+0.5s</button></div></div>
  <div className="timing-field"><label className="field-label">Slot duration (seconds)<input className="text-field" type="number" min="0.1" step="0.1" value={activeSlot.duration} onChange={e => updateSlotTiming(selected.id, activeSlot.id, "duration", Number(e.target.value))}/></label><div className="timing-nudges"><button type="button" aria-label="Shorten slot by 0.5 seconds" onClick={() => updateSlotTiming(selected.id, activeSlot.id, "duration", activeSlot.duration - 0.5)}>−0.5s</button><button type="button" aria-label="Lengthen slot by 0.5 seconds" onClick={() => updateSlotTiming(selected.id, activeSlot.id, "duration", activeSlot.duration + 0.5)}>+0.5s</button></div></div>
  <p>Timeline position: {activeSlot.start.toFixed(1)}s–{(activeSlot.start + activeSlot.duration).toFixed(1)}s. Timing changes apply to this Clip Slot only.</p>
  {activeSlot.start + activeSlot.duration > selected.duration && <p className="timing-warning" role="status">This Clip Slot extends {((activeSlot.start + activeSlot.duration) - selected.duration).toFixed(1)}s beyond the selected shot duration ({selected.duration}s).</p>}
  {selected.slots.some(slot => slot.id !== activeSlot.id && activeSlot.start < slot.start + slot.duration && slot.start < activeSlot.start + activeSlot.duration) && <p className="timing-warning timing-warning-overlap" role="status">This Clip Slot overlaps another slot in the selected shot. Overlap is allowed, but should be reviewed.</p>}
</div><div className="version-list">{activeSlot.versions.map((version, index) => <button key={version.id} className={"version-card " + (version.id === activeSlot.selectedVersionId ? "active" : "")} onClick={() => chooseSlotVersion(selected.id, activeSlot.id, version.id)}><div className="version-thumb"><Film size={20}/><span>V{index + 1}</span></div><div className="version-card-copy"><strong>{version.name}</strong><p>{version.description || "No description yet."}</p><small>{version.duration}s · {version.layers.length} layers · {version.generationRecords.length} generations</small></div><span className="version-current">{version.id === activeSlot.selectedVersionId ? "CURRENT" : "SELECT"}</span></button>)}</div><button className="button button-primary" onClick={() => createSlotVersion(selected.id, activeSlot.id)}><Plus size={14}/> Create new version</button><p className="version-hint">A new version is created from the selected version's settings and layers. Existing versions remain unchanged.</p>{activeVersion && <div className="version-description"><label className="field-label">Selected version description</label><textarea className="text-area" value={activeVersion.description} onChange={e => change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== selected.id ? shot : { ...shot, slots: shot.slots.map(slot => slot.id !== activeSlot.id ? slot : { ...slot, versions: slot.versions.map(version => version.id === activeVersion.id ? { ...version, description: e.target.value } : version) }) }) }))} placeholder="Describe this version..." /></div>}</section>; })()}<div className="timeline-note"><CircleHelp size={15}/><span>{t("timeline.planningNote")}</span></div></>}
          {view === "assets" && <><div className="section-toolbar"><div><h2>{t("assets.title")}</h2><p>{t("assets.description")}</p></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={() => assetFileInput.current?.click()}><Upload size={14}/> {t("asset.actionImport")}</button><button className="button button-primary button-small" onClick={() => setShowAssetForm(v => !v)}><Plus size={15}/> {t("asset.actionAdd")}</button></div><input ref={assetFileInput} type="file" accept="video/*,image/*,audio/*,.js,.mjs,.ts,.html" hidden onChange={e => importAssetFile(e.target.files?.[0])}/></div>{showAssetForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addAsset(assetDraftName, assetDraftKind, assetDraftNotes); }}><label className="field-label">{t("asset.nameLabel")}<input className="text-field" value={assetDraftName} onChange={e => setAssetDraftName(e.target.value)} placeholder={t("asset.namePlaceholder")} required/></label><label className="field-label">{t("asset.kindLabel")}<select className="text-field" value={assetDraftKind} onChange={e => setAssetDraftKind(e.target.value as AssetKind)}>{(["video","image","audio","script","other"] as AssetKind[]).map(kind => <option key={kind} value={kind}>{t(("media."+kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</option>)}</select></label><label className="field-label">{t("asset.notesLabel")}<input className="text-field" value={assetDraftNotes} onChange={e => setAssetDraftNotes(e.target.value)} placeholder={t("asset.notesPlaceholder")}/></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.save")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowAssetForm(false)}>{t("action.cancel")}</button></div></form>}{project.assets.length === 0 ? <div className="empty-state"><div className="empty-icon"><Film size={23}/></div><h3>{t("assets.emptyTitle")}</h3><p>{t("assets.emptyDescription")}</p></div> : <div className="asset-grid">{project.assets.map(a => <article className="asset-card" key={a.id}><div className="asset-card-head"><Film size={19}/><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeAsset(a.id)}>×</button></div><input className="text-field asset-name-field" aria-label={t("asset.nameLabel")} value={a.name} onChange={e => updateAsset(a.id, { name: e.target.value })}/><span>{t(("media." + a.kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</span>{a.kind === "image" && a.path?.startsWith("data:image/") && <button type="button" className="button button-quiet button-small" aria-pressed={previewAssetId === a.id} onClick={() => { setPreviewAssetId(a.id); setEditorWorkspace(true); setNotice("Preview image selected: " + a.name); }}>Preview in editor</button>}{a.path && <small className="asset-path">{a.path.startsWith("data:image/") ? "Image stored locally for preview" : a.path}</small>}<input className="text-field asset-notes-field" aria-label={t("asset.notesLabel")} value={a.notes ?? ""} placeholder={t("asset.notesPlaceholder")} onChange={e => updateAsset(a.id, { notes: e.target.value })}/></article>)}</div>}<p className="inline-note"><CircleHelp size={13}/>{t("assets.importMetadataOnly")}</p></>}
          {view === "references" && <><div className="section-toolbar"><div><h2>{t("references.title")}</h2><p>{t("references.description")}</p></div><button className="button button-primary button-small" onClick={() => setShowProfileForm(v => !v)}><Plus size={15}/> {t("references.actionNewProfile")}</button></div>{showProfileForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addReferenceProfile(); }}><label className="field-label">{t("profile.nameLabel")}<input className="text-field" value={profileDraftName} onChange={e => setProfileDraftName(e.target.value)} placeholder={t("profile.namePlaceholder")} required/></label><label className="field-label">{t("profile.typeLabel")}<select className="text-field" value={profileDraftType} onChange={e => setProfileDraftType(e.target.value as ReferenceProfile["entityType"])}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.createProfile")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowProfileForm(false)}>{t("action.cancel")}</button></div></form>}{project.referenceProfiles.length === 0 ? <div className="empty-state"><div className="empty-icon"><Sparkles size={23}/></div><h3>{t("references.emptyTitle")}</h3><p>{t("references.emptyDescription")}</p><div className="reference-example"><span className="ref-chip">{t("reference.identity")}</span><span className="ref-chip">{t("reference.face")}</span><span className="ref-chip">{t("reference.outfit")}</span><span className="ref-chip">{t("reference.lighting")}</span></div></div> : <div className="profile-list">{project.referenceProfiles.map(profile => <article className="profile-card profile-card-expanded" key={profile.id}><div className="profile-heading"><Sparkles size={18}/><input className="text-field profile-name-field" aria-label={t("profile.nameLabel")} value={profile.name} onChange={e => updateReferenceProfile(profile.id, { name: e.target.value })}/><select className="text-field profile-type-field" aria-label={t("profile.typeLabel")} value={profile.entityType} onChange={e => updateReferenceProfile(profile.id, { entityType: e.target.value as ReferenceProfile["entityType"] })}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeReferenceProfile(profile.id)}>×</button></div><div className="profile-reference-list">{profile.references.length ? profile.references.map(reference => { const asset = project.assets.find(a => a.id === reference.assetId); return <div className="profile-reference-row" key={reference.id}><span className="profile-reference-name">{asset?.name ?? t("references.missingAsset")}</span><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={reference.role} onChange={e => updateProfileReferenceRole(profile.id, reference.id, e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.remove")} onClick={() => removeProfileReference(profile.id, reference.id)}>×</button></div>; }) : <p className="muted-inline">{t("references.noReferences")}</p>}</div><form className="profile-add-reference" onSubmit={e => { e.preventDefault(); addProfileReference(profile.id); }}><select className="text-field" aria-label={t("references.chooseAsset")} value={referenceAssetId} onChange={e => setReferenceAssetId(e.target.value)}><option value="">{t("references.chooseAsset")}</option>{project.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={referenceRole} onChange={e => setReferenceRole(e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button type="submit" className="button button-quiet button-small" disabled={project.assets.length===0}>{t("references.actionAddReference")}</button></form></article>)}</div>}</>}
        </section>
        <aside className="inspector"><div className="inspector-header"><div><span className="inspector-kicker">{t("inspector.title")}</span><h2>{selected ? t("inspector.shotDetails") : t("inspector.projectDetails")}</h2></div><Settings2 size={17}/></div>{selected ? <div className="inspector-content"><div className="inline-actions"><button className="button button-quiet button-small" disabled={!selected} title="Create an independent copy of this shot" onClick={() => selected && duplicateShot(selected.id)}>Duplicate shot</button><button className="button button-quiet button-small danger-action" disabled={project.shots.length <= 1} title={project.shots.length <= 1 ? "A project must keep at least one shot" : "Delete selected shot"} onClick={() => selected && removeShot(selected.id)}>Delete shot</button></div><label className="field-label">{t("inspector.shotTitle")}</label><input className="text-field" value={selected.title} onChange={e => updateShot(selected.id, { title: e.target.value })}/><label className="field-label">{t("inspector.storyIntent")}</label><textarea className="text-area" placeholder={t("inspector.intentPlaceholder")} value={selected.intent} onChange={e => updateShot(selected.id, { intent: e.target.value })} rows={4}/><div className="field-row"><div><label className="field-label">{t("inspector.targetDuration")}</label><div className="number-field"><input type="number" min={1} max={600} value={selected.duration} onChange={e => updateShot(selected.id, { duration: Math.max(1, Number(e.target.value) || 1) })}/><span>{t("inspector.secondsShort")}</span></div></div><div><label className="field-label">{t("inspector.status")}</label><select className="text-field" value={selected.status} onChange={e => updateShot(selected.id, { status: e.target.value as Shot["status"] })}><option value="planned">{t("status.planned")}</option><option value="in-progress">{t("status.in-progress")}</option><option value="ready">{t("status.ready")}</option></select></div></div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.clipSlots")}</span><span className="small-count">{selected.slots.length}</span></div><div className="slot-inspector-list">{selected.slots.map(slot => <div className="slot-inspector" key={slot.id}><div className="slot-icon"><SquarePlay size={16}/></div><div className="slot-copy"><strong>{slot.name}</strong><span>{t("slot.versionCount", { duration: slot.duration, count: slot.versions.length })}</span></div><button className="mini-menu" title="Duplicate clip slot" aria-label={"Duplicate clip slot " + slot.name} onClick={() => duplicateSlot(selected.id, slot.id)}>⧉</button><button className="mini-menu danger-action" disabled={selected.slots.length <= 1} title={selected.slots.length <= 1 ? "A shot must keep at least one clip slot" : "Delete clip slot"} onClick={() => removeSlot(selected.id, slot.id)}>×</button></div>)}</div><button className="add-slot-button" onClick={() => addSlot(selected.id)}><Plus size={14}/> {t("action.addClipSlot")}</button><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("shot.references")}</span><span className="small-count">{selected.referenceProfileIds.length}</span></div><div className="shot-reference-list">{project.referenceProfiles.length ? project.referenceProfiles.map(profile => <div className="shot-reference-profile" key={profile.id}><label className="shot-reference-option"><input type="checkbox" checked={selected.referenceProfileIds.includes(profile.id)} onChange={e => toggleShotReferenceProfile(selected.id, profile.id, e.target.checked)}/><span>{profile.name}<small>{t("profile.referencesCount", { count: profile.references.length })}</small></span></label>{selected.referenceProfileIds.includes(profile.id) && profile.references.map(reference => { const asset = project.assets.find(item => item.id === reference.assetId); const override = selected.referenceOverrides.find(item => item.referenceId === reference.id); const replacements = project.assets.filter(item => item.id !== reference.assetId); return <div className="shot-reference-override" key={reference.id}><span>{asset?.name ?? t("references.missingAsset")}<small>{t(("referenceRole."+reference.role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</small></span><select className="text-field override-action" aria-label={t("shot.referenceOverride")} value={override?.action ?? "inherit"} onChange={e => updateShotReferenceOverride(selected.id, reference.id, e.target.value as "inherit" | "exclude" | "replace")}><option value="inherit">{t("referenceOverride.inherit")}</option><option value="exclude">{t("referenceOverride.exclude")}</option><option value="replace" disabled={replacements.length === 0}>{t("referenceOverride.replace")}</option></select>{override?.action === "replace" && <select className="text-field override-asset" aria-label={t("referenceOverride.replacementAsset")} value={override.replacementAssetId ?? ""} onChange={e => updateShotReferenceOverride(selected.id, reference.id, "replace", e.target.value)}>{replacements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>; })}</div>) : <p className="muted-inline">{t("shot.noReferenceProfiles")}</p>}</div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.aiPlanning")}</span><Sparkles size={14}/></div><div className="ai-hint"><WandSparkles size={16}/><p>{t("inspector.aiHint")}</p></div></div> : <div className="empty-inspector">{t("inspector.empty")}</div>}</aside></div>
        <footer className="statusbar"><div><span className="status-check"><Check size={11}/></span><span>{notice}</span></div><div><span><FileJson size={13}/> {t("footer.projectSchema")}</span><span className="statusbar-separator">·</span><span><ShieldCheck size={13}/> {t("footer.localFirst")}</span><span className="statusbar-separator">·</span><span><WandSparkles size={13}/> <span className="future-label">{t("footer.aiReady")}</span></span></div></footer>
      </div>
    </main>
  </div>;
}
