import { useState } from "react";
import { X, CheckCircle2, Circle, Copy, Check, Film, User, MapPin, Palette } from "lucide-react";
import type { DionysusProject, Shot } from "./types";

interface ProductionChecklistDrawerProps {
  project: DionysusProject;
  isOpen: boolean;
  onClose: () => void;
  onSelectShot: (shotId: string) => void;
  onUpdateShotStatus: (shotId: string, status: Shot["status"]) => void;
  onOpenTimeline: () => void;
}

export default function ProductionChecklistDrawer({
  project,
  isOpen,
  onClose,
  onSelectShot,
  onUpdateShotStatus,
  onOpenTimeline
}: ProductionChecklistDrawerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const totalShots = project.shots.length;
  const readyShots = project.shots.filter(s => s.status === "ready").length;
  const progressPercent = totalShots > 0 ? Math.round((readyShots / totalShots) * 100) : 0;

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="checklist-drawer-backdrop" onClick={onClose}>
      <div className="checklist-drawer-panel" onClick={e => e.stopPropagation()}>
        <header className="checklist-header">
          <div className="checklist-title">
            <CheckCircle2 size={20} color="#75d7c1" />
            <div>
              <h3>AI Video Production Guide</h3>
              <p>Step-by-step asset generation checklist for this project</p>
            </div>
          </div>
          <button className="checklist-close" onClick={onClose}><X size={18} /></button>
        </header>

        {/* Overall Progress Meter */}
        <div className="checklist-progress-card">
          <div className="progress-info">
            <span>Overall Readiness</span>
            <strong>{readyShots} of {totalShots} shots ready ({progressPercent}%)</strong>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>

        <div className="checklist-content">
          {/* Phase 1: Reference Profiles */}
          <section className="checklist-section">
            <div className="section-head">
              <span className="step-tag">STEP 1</span>
              <h4>Consistent Reference Assets</h4>
            </div>
            <p className="section-subtext">
              Generate reference images for your characters and locations first to maintain visual consistency across all AI shots.
            </p>

            <div className="checklist-items">
              {project.referenceProfiles.length === 0 ? (
                <div className="checklist-empty-note">
                  No reference profiles created yet. Add Character or Environment profiles to lock in consistent faces, outfits, and lighting.
                </div>
              ) : (
                project.referenceProfiles.map(profile => {
                  const hasAsset = profile.references.length > 0;
                  return (
                    <div key={profile.id} className={`checklist-item-card ${hasAsset ? "completed" : ""}`}>
                      <div className="item-icon">
                        {profile.entityType === "character" ? <User size={16} /> : profile.entityType === "environment" ? <MapPin size={16} /> : <Palette size={16} />}
                      </div>
                      <div className="item-details">
                        <strong>{profile.name}</strong>
                        <span>{profile.entityType} · {profile.references.length} reference asset{profile.references.length === 1 ? "" : "s"} attached</span>
                      </div>
                      <span className={`status-pill ${hasAsset ? "ready" : "pending"}`}>
                        {hasAsset ? "Anchored" : "Needs Asset"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Phase 2: Shot Generation Checklist */}
          <section className="checklist-section">
            <div className="section-head">
              <span className="step-tag">STEP 2</span>
              <h4>Shot-by-Shot Generation Pipeline</h4>
            </div>
            <p className="section-subtext">
              Execute each prompt in your preferred AI generator (Midjourney, Flux, Kling, Runway, Luma), then mark the beat as ready.
            </p>

            <div className="checklist-items">
              {project.shots.map((shot, idx) => {
                const isReady = shot.status === "ready";
                const isCopied = copiedId === shot.id;
                const prompt = shot.generationPrompt || shot.intent || shot.title;

                return (
                  <div key={shot.id} className={`checklist-shot-card ${isReady ? "ready" : ""}`}>
                    <div className="shot-check-row">
                      <button
                        className="check-toggle-btn"
                        onClick={() => onUpdateShotStatus(shot.id, isReady ? "in-progress" : "ready")}
                        title={isReady ? "Mark not ready" : "Mark as generated / ready"}
                      >
                        {isReady ? <CheckCircle2 size={18} color="#75d7c1" /> : <Circle size={18} color="#74747e" />}
                      </button>

                      <div className="shot-check-copy" onClick={() => onSelectShot(shot.id)}>
                        <span className="shot-num-label">Shot #{idx + 1} ({shot.duration}s)</span>
                        <strong>{shot.title}</strong>
                      </div>

                      <button
                        className="copy-prompt-action"
                        onClick={() => handleCopy(shot.id, prompt)}
                        title="Copy AI generation prompt"
                      >
                        {isCopied ? <><Check size={12} color="#d5f36a" /> Copied</> : <><Copy size={12} /> Copy Prompt</>}
                      </button>
                    </div>

                    <div className="shot-prompt-preview">
                      <p>{prompt}</p>
                    </div>

                    {shot.referenceProfileIds.length > 0 && (
                      <div className="shot-required-tags">
                        <span>Required References:</span>
                        {shot.referenceProfileIds.map(pId => {
                          const p = project.referenceProfiles.find(x => x.id === pId);
                          return p ? <span key={pId} className="tag-pill">{p.name}</span> : null;
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Phase 3: Final Timeline Assemble */}
          <section className="checklist-section">
            <div className="section-head">
              <span className="step-tag">STEP 3</span>
              <h4>Assemble to Timeline</h4>
            </div>
            <p className="section-subtext">
              Once your clips are ready, sync them to the Master Timeline for sound mixing, multi-track layering, and video export.
            </p>
            <button className="button button-primary" style={{ width: "100%", padding: "11px" }} onClick={onOpenTimeline}>
              <Film size={16} /> Open Timeline & Compositor Workspace
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
