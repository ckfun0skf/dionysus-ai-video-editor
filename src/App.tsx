import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, ChevronDown, CircleHelp, Clapperboard, Clock3, Download, FileJson, Film, FolderOpen, Layers3, Plus, Save, Settings2, ShieldCheck, Sparkles, SquarePlay, Upload, WandSparkles } from "lucide-react";
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
  const [view, setView] = useState<View>("storyboard");
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
  const selected = project.shots.find(s => s.id === selectedId) ?? project.shots[0];
  const runtime = useMemo(() => project.shots.reduce((n, s) => n + s.duration, 0), [project.shots]);
  const slotCount = project.shots.reduce((n, s) => n + s.slots.length, 0);
  function change(fn: (p: DionysusProject) => DionysusProject) { setProject(p => ({ ...fn(p), updatedAt: new Date().toISOString() })); }
  function addShot() {
    const shotId = id("shot"), slotId = id("slot"), versionId = id("version");
    const shot: Shot = { id: shotId, title: String(project.shots.length + 1).padStart(2, "0") + " · " + t("shot.defaultTitle"), intent: "", duration: 5, status: "planned", referenceProfileIds: [], referenceOverrides: [], slots: [{ id: slotId, name: t("slot.defaultName"), start: 0, duration: 5, selectedVersionId: versionId, versions: [{ id: versionId, name: t("version.defaultName"), description: "", duration: 5, layers: [], scriptVersionIds: [], generationRecords: [] }] }] };
    change(p => ({ ...p, shots: [...p.shots, shot] })); setSelectedId(shotId); setNotice(t("notice.shotAdded"));
  }
  function addSlot(shotId: string) {
    const slotId = id("slot"), versionId = id("version");
    change(p => ({ ...p, shots: p.shots.map(s => s.id !== shotId ? s : { ...s, slots: [...s.slots, { id: slotId, name: t("slot.defaultPrefix") + (s.slots.length + 1), start: s.slots.reduce((n, c) => Math.max(n, c.start + c.duration), 0), duration: 3, selectedVersionId: versionId, versions: [{ id: versionId, name: t("version.defaultName"), description: "", duration: 3, layers: [], scriptVersionIds: [], generationRecords: [] }] }] }) }));
    setNotice(t("notice.clipSlotAdded"));
  }
  function updateShot(shotId: string, patch: Partial<Shot>) { change(p => ({ ...p, shots: p.shots.map(s => s.id === shotId ? { ...s, ...patch } : s) })); }
  function selectClipSlot(slotId: string) { setSelectedSlotId(slotId); }
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
      setProject(data); setSelectedId(data.shots[0]?.id ?? ""); setNotice(t("notice.projectImported"));
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
      <div className="page-content">
        <section className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> {t("heading.eyebrow")}</div><h1>{view === "storyboard" ? t("heading.storyboard.title") : view === "timeline" ? t("heading.timeline.title") : view === "assets" ? t("heading.assets.title") : t("heading.references.title")}</h1><p>{view === "storyboard" ? t("heading.storyboard.description") : view === "timeline" ? t("heading.timeline.description") : view === "assets" ? t("heading.assets.description") : t("heading.references.description")}</p></div><div className="heading-meta"><span className="status-dot"/> {t("status.autosaved")} <span className="meta-divider"/> <span>{t("project.versionFoundation")}</span></div></section>
        <section className="project-overview"><div className="overview-main"><div className="overview-icon"><Clapperboard size={19}/></div><div className="overview-copy"><div className="overview-kicker">{t("project.current")}</div><input className="project-name-input" aria-label={t("project.name")} value={project.name} onChange={e => change(p => ({ ...p, name: e.target.value }))}/><div className="project-subline"><span><Clock3 size={13}/> {t("project.runtimeSummary", { duration: time(runtime) })}</span><span><Film size={13}/> {t("project.shotCount", { count: project.shots.length })}</span><span><Layers3 size={13}/> {t("project.clipSlotCount", { count: slotCount })}</span></div></div></div><div className="project-specs"><div><span>{t("project.canvas")}</span><strong>{project.width} × {project.height}</strong></div><div><span>{t("project.frameRate")}</span><strong>{project.frameRate} FPS</strong></div><button className="icon-button" title={t("project.canvasSettingsPlanned")} onClick={() => setNotice(t("notice.canvasSettingsUnavailable"))}><Settings2 size={17}/></button></div></section>
        <div className="workbench"><section className="workbench-main">
          {view === "storyboard" && <><div className="section-toolbar"><div><h2>{t("storyboard.title")}</h2><p>{t("storyboard.shotCount", { count: project.shots.length })}</p></div><button className="button button-primary button-small" onClick={addShot}><Plus size={15}/> {t("action.addShot")}</button></div><div className="shot-list">{project.shots.map((shot, i) => <button key={shot.id} className={"shot-card " + (selected?.id === shot.id ? "selected" : "")} onClick={() => setSelectedId(shot.id)}><div className="shot-number">{String(i + 1).padStart(2, "0")}</div><div className="shot-thumb"><div className="thumb-grid"/><div className="thumb-center"><Film size={21}/></div><span>{time(shot.duration)}</span></div><div className="shot-card-body"><div className="shot-title-row"><h3>{shot.title}</h3><span className={"shot-status status-" + shot.status}>{t(("status." + shot.status) as "status.planned" | "status.in-progress" | "status.ready")}</span></div><p>{shot.intent || t("shot.emptyIntent")}</p><div className="shot-card-meta"><span><Layers3 size={13}/> {t("shot.clipSlotCount", { count: shot.slots.length })}</span><span><Clock3 size={13}/> {t("shot.durationTarget", { duration: shot.duration })}</span></div></div><div className="shot-arrow">↗</div></button>)}<button className="add-shot-card" onClick={addShot}><span><Plus size={17}/></span><strong>{t("shot.addAnother")}</strong><small>{t("shot.addAnotherHint")}</small></button></div></>}
          {view === "timeline" && <><div className="section-toolbar"><div><h2>{t("timeline.title")}</h2><p>{t("timeline.description")}</p></div><button className="button button-primary button-small" disabled={!selected} onClick={() => selected && addSlot(selected.id)}><Plus size={15}/> {t("action.addClipSlot")}</button></div><div className="timeline-ruler">{["00:00","00:05","00:10","00:15","00:20","00:25"].map(t => <span key={t}>{t}</span>)}</div><div className="timeline-scroll">{project.tracks.map((track, i) => <div className="timeline-track" key={track.id}><div className="track-label">{track.kind === "audio" ? <AudioLines size={14}/> : track.kind === "text" ? <Sparkles size={14}/> : <Film size={14}/>}<span>{t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects")}</span></div><div className="track-lane">{i === 0 && project.shots.map((shot, si) => <button key={shot.id} className={"timeline-shot " + (selected?.id === shot.id ? "chosen" : "")} style={{ left: (project.shots.slice(0, si).reduce((n, s) => n + s.duration, 0) / Math.max(runtime, 1) * 100) + "%", width: (shot.duration / Math.max(runtime, 1) * 100) + "%" }} onClick={() => setSelectedId(shot.id)}><span>{shot.title}</span><small>{shot.duration}s</small></button>)}{i === 1 && selected?.slots.map(slot => <button key={slot.id} className="timeline-slot" style={{ left: (slot.start / Math.max(selected.duration, 1) * 100) + "%", width: (slot.duration / Math.max(selected.duration, 1) * 100) + "%" }} onClick={() => selectClipSlot(slot.id)}><span>{slot.name}</span><small>{slot.versions.find(v => v.id === slot.selectedVersionId)?.name ?? "No version"}</small></button>)}{i > 1 && <div className="track-empty"><span>+</span> {t("timeline.trackAddLayer", { kind: t(("media." + track.kind) as "media.video" | "media.audio" | "media.text" | "media.effects") })}</div>}</div></div>)}</div>{selected && (() => { const activeSlot = selected.slots.find(slot => slot.id === selectedSlotId); if (!activeSlot) return null; const activeVersion = activeSlot.versions.find(version => version.id === activeSlot.selectedVersionId); return <section className="version-panel"><div className="version-panel-heading"><div><span className="inspector-kicker">CLIP SLOT</span><h3>{activeSlot.name}</h3><p>{activeSlot.duration}s · {activeSlot.versions.length} version{activeSlot.versions.length === 1 ? "" : "s"}</p></div><button className="button button-quiet button-small" onClick={() => setSelectedSlotId("")}>Close</button></div><div className="slot-timing-controls">
  <label className="field-label">Start time (seconds)<input className="text-field" type="number" min="0" step="0.1" value={activeSlot.start} onChange={e => updateSlotTiming(selected.id, activeSlot.id, "start", Number(e.target.value))}/></label>
  <label className="field-label">Slot duration (seconds)<input className="text-field" type="number" min="0.1" step="0.1" value={activeSlot.duration} onChange={e => updateSlotTiming(selected.id, activeSlot.id, "duration", Number(e.target.value))}/></label>
  <p>Timeline position: {activeSlot.start.toFixed(1)}s–{(activeSlot.start + activeSlot.duration).toFixed(1)}s. Timing changes apply to this Clip Slot only.</p>
  {activeSlot.start + activeSlot.duration > selected.duration && <p className="timing-warning" role="status">This Clip Slot extends {((activeSlot.start + activeSlot.duration) - selected.duration).toFixed(1)}s beyond the selected shot duration ({selected.duration}s).</p>}
  {selected.slots.some(slot => slot.id !== activeSlot.id && activeSlot.start < slot.start + slot.duration && slot.start < activeSlot.start + activeSlot.duration) && <p className="timing-warning timing-warning-overlap" role="status">This Clip Slot overlaps another slot in the selected shot. Overlap is allowed, but should be reviewed.</p>}
</div><div className="version-list">{activeSlot.versions.map((version, index) => <button key={version.id} className={"version-card " + (version.id === activeSlot.selectedVersionId ? "active" : "")} onClick={() => chooseSlotVersion(selected.id, activeSlot.id, version.id)}><div className="version-thumb"><Film size={20}/><span>V{index + 1}</span></div><div className="version-card-copy"><strong>{version.name}</strong><p>{version.description || "No description yet."}</p><small>{version.duration}s · {version.layers.length} layers · {version.generationRecords.length} generations</small></div><span className="version-current">{version.id === activeSlot.selectedVersionId ? "CURRENT" : "SELECT"}</span></button>)}</div><button className="button button-primary" onClick={() => createSlotVersion(selected.id, activeSlot.id)}><Plus size={14}/> Create new version</button><p className="version-hint">A new version is created from the selected version's settings and layers. Existing versions remain unchanged.</p>{activeVersion && <div className="version-description"><label className="field-label">Selected version description</label><textarea className="text-area" value={activeVersion.description} onChange={e => change(p => ({ ...p, shots: p.shots.map(shot => shot.id !== selected.id ? shot : { ...shot, slots: shot.slots.map(slot => slot.id !== activeSlot.id ? slot : { ...slot, versions: slot.versions.map(version => version.id === activeVersion.id ? { ...version, description: e.target.value } : version) }) }) }))} placeholder="Describe this version..." /></div>}</section>; })()}<div className="timeline-note"><CircleHelp size={15}/><span>{t("timeline.planningNote")}</span></div></>}
          {view === "assets" && <><div className="section-toolbar"><div><h2>{t("assets.title")}</h2><p>{t("assets.description")}</p></div><div className="inline-actions"><button className="button button-quiet button-small" onClick={() => assetFileInput.current?.click()}><Upload size={14}/> {t("asset.actionImport")}</button><button className="button button-primary button-small" onClick={() => setShowAssetForm(v => !v)}><Plus size={15}/> {t("asset.actionAdd")}</button></div><input ref={assetFileInput} type="file" accept="video/*,image/*,audio/*,.js,.mjs,.ts,.html" hidden onChange={e => importAssetFile(e.target.files?.[0])}/></div>{showAssetForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addAsset(assetDraftName, assetDraftKind, assetDraftNotes); }}><label className="field-label">{t("asset.nameLabel")}<input className="text-field" value={assetDraftName} onChange={e => setAssetDraftName(e.target.value)} placeholder={t("asset.namePlaceholder")} required/></label><label className="field-label">{t("asset.kindLabel")}<select className="text-field" value={assetDraftKind} onChange={e => setAssetDraftKind(e.target.value as AssetKind)}>{(["video","image","audio","script","other"] as AssetKind[]).map(kind => <option key={kind} value={kind}>{t(("media."+kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</option>)}</select></label><label className="field-label">{t("asset.notesLabel")}<input className="text-field" value={assetDraftNotes} onChange={e => setAssetDraftNotes(e.target.value)} placeholder={t("asset.notesPlaceholder")}/></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.save")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowAssetForm(false)}>{t("action.cancel")}</button></div></form>}{project.assets.length === 0 ? <div className="empty-state"><div className="empty-icon"><Film size={23}/></div><h3>{t("assets.emptyTitle")}</h3><p>{t("assets.emptyDescription")}</p></div> : <div className="asset-grid">{project.assets.map(a => <article className="asset-card" key={a.id}><div className="asset-card-head"><Film size={19}/><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeAsset(a.id)}>×</button></div><input className="text-field asset-name-field" aria-label={t("asset.nameLabel")} value={a.name} onChange={e => updateAsset(a.id, { name: e.target.value })}/><span>{t(("media." + a.kind) as "media.video" | "media.image" | "media.audio" | "media.script" | "media.other")}</span>{a.path && <small className="asset-path">{a.path}</small>}<input className="text-field asset-notes-field" aria-label={t("asset.notesLabel")} value={a.notes ?? ""} placeholder={t("asset.notesPlaceholder")} onChange={e => updateAsset(a.id, { notes: e.target.value })}/></article>)}</div>}<p className="inline-note"><CircleHelp size={13}/>{t("assets.importMetadataOnly")}</p></>}
          {view === "references" && <><div className="section-toolbar"><div><h2>{t("references.title")}</h2><p>{t("references.description")}</p></div><button className="button button-primary button-small" onClick={() => setShowProfileForm(v => !v)}><Plus size={15}/> {t("references.actionNewProfile")}</button></div>{showProfileForm && <form className="editor-form" onSubmit={e => { e.preventDefault(); addReferenceProfile(); }}><label className="field-label">{t("profile.nameLabel")}<input className="text-field" value={profileDraftName} onChange={e => setProfileDraftName(e.target.value)} placeholder={t("profile.namePlaceholder")} required/></label><label className="field-label">{t("profile.typeLabel")}<select className="text-field" value={profileDraftType} onChange={e => setProfileDraftType(e.target.value as ReferenceProfile["entityType"])}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select></label><div className="inline-actions"><button type="submit" className="button button-primary button-small">{t("action.createProfile")}</button><button type="button" className="button button-quiet button-small" onClick={() => setShowProfileForm(false)}>{t("action.cancel")}</button></div></form>}{project.referenceProfiles.length === 0 ? <div className="empty-state"><div className="empty-icon"><Sparkles size={23}/></div><h3>{t("references.emptyTitle")}</h3><p>{t("references.emptyDescription")}</p><div className="reference-example"><span className="ref-chip">{t("reference.identity")}</span><span className="ref-chip">{t("reference.face")}</span><span className="ref-chip">{t("reference.outfit")}</span><span className="ref-chip">{t("reference.lighting")}</span></div></div> : <div className="profile-list">{project.referenceProfiles.map(profile => <article className="profile-card profile-card-expanded" key={profile.id}><div className="profile-heading"><Sparkles size={18}/><input className="text-field profile-name-field" aria-label={t("profile.nameLabel")} value={profile.name} onChange={e => updateReferenceProfile(profile.id, { name: e.target.value })}/><select className="text-field profile-type-field" aria-label={t("profile.typeLabel")} value={profile.entityType} onChange={e => updateReferenceProfile(profile.id, { entityType: e.target.value as ReferenceProfile["entityType"] })}>{(["character","environment","prop","style","other"] as ReferenceProfile["entityType"][]).map(kind => <option key={kind} value={kind}>{t(("entityType."+kind) as "entityType.character" | "entityType.environment" | "entityType.prop" | "entityType.style" | "entityType.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.delete")} onClick={() => removeReferenceProfile(profile.id)}>×</button></div><div className="profile-reference-list">{profile.references.length ? profile.references.map(reference => { const asset = project.assets.find(a => a.id === reference.assetId); return <div className="profile-reference-row" key={reference.id}><span className="profile-reference-name">{asset?.name ?? t("references.missingAsset")}</span><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={reference.role} onChange={e => updateProfileReferenceRole(profile.id, reference.id, e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button className="mini-menu danger-action" title={t("action.remove")} onClick={() => removeProfileReference(profile.id, reference.id)}>×</button></div>; }) : <p className="muted-inline">{t("references.noReferences")}</p>}</div><form className="profile-add-reference" onSubmit={e => { e.preventDefault(); addProfileReference(profile.id); }}><select className="text-field" aria-label={t("references.chooseAsset")} value={referenceAssetId} onChange={e => setReferenceAssetId(e.target.value)}><option value="">{t("references.chooseAsset")}</option>{project.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select><select className="text-field role-select" aria-label={t("reference.roleLabel")} value={referenceRole} onChange={e => setReferenceRole(e.target.value as ReferenceRole)}>{(["identity","face","body","outfit","pose","composition","lighting","environment","style","other"] as ReferenceRole[]).map(role => <option key={role} value={role}>{t(("referenceRole."+role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</option>)}</select><button type="submit" className="button button-quiet button-small" disabled={project.assets.length===0}>{t("references.actionAddReference")}</button></form></article>)}</div>}</>}
        </section>
        <aside className="inspector"><div className="inspector-header"><div><span className="inspector-kicker">{t("inspector.title")}</span><h2>{selected ? t("inspector.shotDetails") : t("inspector.projectDetails")}</h2></div><Settings2 size={17}/></div>{selected ? <div className="inspector-content"><label className="field-label">{t("inspector.shotTitle")}</label><input className="text-field" value={selected.title} onChange={e => updateShot(selected.id, { title: e.target.value })}/><label className="field-label">{t("inspector.storyIntent")}</label><textarea className="text-area" placeholder={t("inspector.intentPlaceholder")} value={selected.intent} onChange={e => updateShot(selected.id, { intent: e.target.value })} rows={4}/><div className="field-row"><div><label className="field-label">{t("inspector.targetDuration")}</label><div className="number-field"><input type="number" min={1} max={600} value={selected.duration} onChange={e => updateShot(selected.id, { duration: Math.max(1, Number(e.target.value) || 1) })}/><span>{t("inspector.secondsShort")}</span></div></div><div><label className="field-label">{t("inspector.status")}</label><select className="text-field" value={selected.status} onChange={e => updateShot(selected.id, { status: e.target.value as Shot["status"] })}><option value="planned">{t("status.planned")}</option><option value="in-progress">{t("status.in-progress")}</option><option value="ready">{t("status.ready")}</option></select></div></div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.clipSlots")}</span><span className="small-count">{selected.slots.length}</span></div><div className="slot-inspector-list">{selected.slots.map(slot => <div className="slot-inspector" key={slot.id}><div className="slot-icon"><SquarePlay size={16}/></div><div className="slot-copy"><strong>{slot.name}</strong><span>{t("slot.versionCount", { duration: slot.duration, count: slot.versions.length })}</span></div><button className="mini-menu" title={t("action.showSlotDetails")} onClick={() => setNotice(t("notice.slotSelectedVersion", { name: slot.name, versionId: slot.selectedVersionId }))}>···</button></div>)}</div><button className="add-slot-button" onClick={() => addSlot(selected.id)}><Plus size={14}/> {t("action.addClipSlot")}</button><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("shot.references")}</span><span className="small-count">{selected.referenceProfileIds.length}</span></div><div className="shot-reference-list">{project.referenceProfiles.length ? project.referenceProfiles.map(profile => <div className="shot-reference-profile" key={profile.id}><label className="shot-reference-option"><input type="checkbox" checked={selected.referenceProfileIds.includes(profile.id)} onChange={e => toggleShotReferenceProfile(selected.id, profile.id, e.target.checked)}/><span>{profile.name}<small>{t("profile.referencesCount", { count: profile.references.length })}</small></span></label>{selected.referenceProfileIds.includes(profile.id) && profile.references.map(reference => { const asset = project.assets.find(item => item.id === reference.assetId); const override = selected.referenceOverrides.find(item => item.referenceId === reference.id); const replacements = project.assets.filter(item => item.id !== reference.assetId); return <div className="shot-reference-override" key={reference.id}><span>{asset?.name ?? t("references.missingAsset")}<small>{t(("referenceRole."+reference.role) as "referenceRole.identity" | "referenceRole.face" | "referenceRole.body" | "referenceRole.outfit" | "referenceRole.pose" | "referenceRole.composition" | "referenceRole.lighting" | "referenceRole.environment" | "referenceRole.style" | "referenceRole.other")}</small></span><select className="text-field override-action" aria-label={t("shot.referenceOverride")} value={override?.action ?? "inherit"} onChange={e => updateShotReferenceOverride(selected.id, reference.id, e.target.value as "inherit" | "exclude" | "replace")}><option value="inherit">{t("referenceOverride.inherit")}</option><option value="exclude">{t("referenceOverride.exclude")}</option><option value="replace" disabled={replacements.length === 0}>{t("referenceOverride.replace")}</option></select>{override?.action === "replace" && <select className="text-field override-asset" aria-label={t("referenceOverride.replacementAsset")} value={override.replacementAssetId ?? ""} onChange={e => updateShotReferenceOverride(selected.id, reference.id, "replace", e.target.value)}>{replacements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}</div>; })}</div>) : <p className="muted-inline">{t("shot.noReferenceProfiles")}</p>}</div><div className="inspector-divider"/><div className="inspector-subheading"><span>{t("inspector.aiPlanning")}</span><Sparkles size={14}/></div><div className="ai-hint"><WandSparkles size={16}/><p>{t("inspector.aiHint")}</p></div></div> : <div className="empty-inspector">{t("inspector.empty")}</div>}</aside></div>
        <footer className="statusbar"><div><span className="status-check"><Check size={11}/></span><span>{notice}</span></div><div><span><FileJson size={13}/> {t("footer.projectSchema")}</span><span className="statusbar-separator">·</span><span><ShieldCheck size={13}/> {t("footer.localFirst")}</span><span className="statusbar-separator">·</span><span><WandSparkles size={13}/> <span className="future-label">{t("footer.aiReady")}</span></span></div></footer>
      </div>
    </main>
  </div>;
}
