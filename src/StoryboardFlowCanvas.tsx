import { useState, useRef, useMemo } from "react";
import {
  Plus, Copy, Check, Sparkles, Film,
  Maximize2, ZoomIn, ZoomOut, RotateCcw, Trash2,
  Clock3, Video, CheckCircle2, ChevronDown
} from "lucide-react";
import type { Shot, DionysusProject, StoryboardConnection } from "./types";

interface StoryboardFlowCanvasProps {
  project: DionysusProject;
  selectedShotId: string;
  onSelectShot: (shotId: string) => void;
  onUpdateShot: (shotId: string, patch: Partial<Shot>) => void;
  onAddShot: () => void;
  onDeleteShot: (shotId: string) => void;
  onDuplicateShot: (shotId: string) => void;
  onAddConnection: (fromShotId: string, toShotId: string, label?: string) => void;
  onRemoveConnection: (fromShotId: string, toShotId: string) => void;
  onOpenAgentModal: () => void;
  onOpenChecklist: () => void;
  onSyncTimeline: () => void;
  onAttachAssetToShot?: (shotId: string, file: File) => void;
  onSelectVersion?: (shotId: string, slotId: string, versionId: string) => void;
}

export default function StoryboardFlowCanvas({
  project,
  selectedShotId,
  onSelectShot,
  onUpdateShot,
  onAddShot,
  onDeleteShot,
  onDuplicateShot,
  onAddConnection,
  onRemoveConnection,
  onOpenAgentModal,
  onOpenChecklist,
  onSyncTimeline,
  onAttachAssetToShot,
  onSelectVersion
}: StoryboardFlowCanvasProps) {
  // Canvas viewport state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [expandedVersionShotId, setExpandedVersionShotId] = useState<string>("");
  const panStartRef = useRef({ x: 0, y: 0 });

  // Dragging shot nodes
  const [draggingShotId, setDraggingShotId] = useState<string | null>(null);
  const dragStartPosRef = useRef({ mouseX: 0, mouseY: 0, nodeX: 0, nodeY: 0 });

  // Wire connection dragging state
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState({ x: 0, y: 0 });

  // Prompt copy feedback state
  const [copiedShotId, setCopiedShotId] = useState<string | null>(null);

  // Hidden file input for uploading keyframe/thumbnail directly into a shot
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUploadShotIdRef = useRef<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // Node dimensions
  const NODE_WIDTH = 340;

  // Compute connections
  const connections: StoryboardConnection[] = useMemo(() => {
    if (project.storyboardConnections && project.storyboardConnections.length > 0) {
      return project.storyboardConnections;
    }
    // Fallback: sequential connections if none explicitly defined
    const list: StoryboardConnection[] = [];
    for (let i = 0; i < project.shots.length - 1; i++) {
      list.push({
        fromShotId: project.shots[i].id,
        toShotId: project.shots[i + 1].id,
        label: "Sequential cut"
      });
    }
    return list;
  }, [project.storyboardConnections, project.shots]);

  // Handle pan
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only pan if clicking on the background (not on a card)
    if ((e.target as HTMLElement).closest(".storyboard-node-card")) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      // Calculate canvas coordinates of mouse for wire dragging
      const cx = (e.clientX - rect.left - pan.x) / zoom;
      const cy = (e.clientY - rect.top - pan.y) / zoom;
      setMouseCanvasPos({ x: cx, y: cy });
    }

    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y
      });
    } else if (draggingShotId) {
      const dx = (e.clientX - dragStartPosRef.current.mouseX) / zoom;
      const dy = (e.clientY - dragStartPosRef.current.mouseY) / zoom;
      const newX = Math.round(dragStartPosRef.current.nodeX + dx);
      const newY = Math.round(dragStartPosRef.current.nodeY + dy);
      onUpdateShot(draggingShotId, { canvasX: Math.max(20, newX), canvasY: Math.max(20, newY) });
    }
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      setIsPanning(false);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
    if (draggingShotId) {
      setDraggingShotId(null);
    }
    if (connectingFromId) {
      setConnectingFromId(null);
    }
  };

  // Node drag initiation
  const startDragNode = (e: React.PointerEvent, shot: Shot) => {
    // Don't drag if clicking buttons or inputs inside card
    const target = e.target as HTMLElement;
    if (target.closest("button") || target.closest("input") || target.closest("textarea") || target.closest("select") || target.closest(".port-handle")) {
      return;
    }
    e.stopPropagation();
    onSelectShot(shot.id);
    setDraggingShotId(shot.id);
    dragStartPosRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      nodeX: shot.canvasX ?? 100,
      nodeY: shot.canvasY ?? 100
    };
  };

  // Copy prompt helper
  const copyPrompt = (shot: Shot) => {
    const prompt = shot.generationPrompt || shot.intent || shot.title;
    navigator.clipboard.writeText(prompt);
    setCopiedShotId(shot.id);
    setTimeout(() => setCopiedShotId(null), 1800);
  };

  // Auto-arrange nodes in a clean flow grid
  const autoArrange = () => {
    const colCount = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(project.shots.length * 1.6))));
    const gapX = 390;
    const gapY = 410;
    project.shots.forEach((shot, index) => {
      const col = index % colCount;
      const row = Math.floor(index / colCount);
      onUpdateShot(shot.id, {
        canvasX: 80 + col * gapX,
        canvasY: 90 + row * gapY
      });
    });
  };

  // Trigger file upload for a shot thumbnail
  const handleUploadClick = (shotId: string) => {
    activeUploadShotIdRef.current = shotId;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const shotId = activeUploadShotIdRef.current;
    if (file && shotId && onAttachAssetToShot) {
      onAttachAssetToShot(shotId, file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Shot coordinate lookup
  const getShotPosition = (shotId: string) => {
    const index = project.shots.findIndex(s => s.id === shotId);
    const shot = project.shots[index];
    if (!shot) return { x: 0, y: 0 };
    if (shot.canvasX !== undefined && shot.canvasY !== undefined) {
      return { x: shot.canvasX, y: shot.canvasY };
    }
    // Fallback default coordinates
    const col = index % 3;
    const row = Math.floor(index / 3);
    return { x: 80 + col * 390, y: 90 + row * 410 };
  };

  return (
    <div className="storyboard-flow-container">
      {/* Top Floating Control Bar */}
      <div className="flow-toolbar">
        <div className="flow-toolbar-left">
          <button
            className="flow-tool-btn primary"
            onClick={onAddShot}
            title="Add a new storyboard beat node"
          >
            <Plus size={16} /> Add Shot Node
          </button>
          <button
            className="flow-tool-btn"
            onClick={onOpenAgentModal}
            title="Brainstorm story with AI and import JSON storyboard"
          >
            <Sparkles size={16} color="#d5f36a" /> AI Storyboard Plan
          </button>
          <button
            className="flow-tool-btn"
            onClick={onOpenChecklist}
            title="Step-by-step production and asset generation checklist"
          >
            <CheckCircle2 size={16} color="#75d7c1" /> Production Checklist
          </button>
          <button
            className="flow-tool-btn"
            onClick={onSyncTimeline}
            title="Transfer storyboard sequence to master timeline tracks"
          >
            <Film size={16} /> Sync to Timeline
          </button>
        </div>

        <div className="flow-toolbar-right">
          <div className="zoom-controls">
            <button
              onClick={() => setZoom(z => Math.max(0.4, Number((z - 0.15).toFixed(2))))}
              title="Zoom out"
            >
              <ZoomOut size={14} />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom(z => Math.min(2.0, Number((z + 0.15).toFixed(2))))}
              title="Zoom in"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              title="Reset view"
            >
              <RotateCcw size={14} />
            </button>
          </div>
          <button className="flow-tool-btn quiet" onClick={autoArrange} title="Auto-layout nodes in flow grid">
            <Maximize2 size={15} /> Auto Arrange
          </button>
        </div>
      </div>

      {/* Hidden file input for uploading images to cards */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Interactive Canvas */}
      <div
        ref={canvasRef}
        className="flow-canvas"
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
      >
        <div
          className="flow-canvas-viewport"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0"
          }}
        >
          {/* SVG Connection Cables (SeeDance style) */}
          <svg className="flow-connections-svg">
            <defs>
              <marker
                id="flow-arrow"
                viewBox="0 0 10 10"
                refX="7"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 9 5 L 0 9 z" fill="#d5f36a" />
              </marker>
              <linearGradient id="flow-line-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#8cb7ff" />
                <stop offset="100%" stopColor="#d5f36a" />
              </linearGradient>
            </defs>

            {/* Render established connections */}
            {connections.map((conn, idx) => {
              const fromPos = getShotPosition(conn.fromShotId);
              const toPos = getShotPosition(conn.toShotId);
              if (!fromPos || !toPos) return null;

              // Wire starts at the right edge of source card
              const startX = fromPos.x + NODE_WIDTH;
              const startY = fromPos.y + 120;
              // Wire ends at the left edge of destination card
              const endX = toPos.x;
              const endY = toPos.y + 120;

              const deltaX = Math.abs(endX - startX) * 0.55;
              const cp1X = startX + Math.max(60, deltaX);
              const cp1Y = startY;
              const cp2X = endX - Math.max(60, deltaX);
              const cp2Y = endY;

              const pathData = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
              const midX = (startX + endX) / 2;
              const midY = (startY + endY) / 2;

              return (
                <g key={`conn-${conn.fromShotId}-${conn.toShotId}-${idx}`} className="flow-connection-group">
                  {/* Invisible thicker path for easier hovering/clicking */}
                  <g onClick={() => onRemoveConnection(conn.fromShotId, conn.toShotId)}>
                    <title>Click to remove transition link</title>
                    <path
                      d={pathData}
                      className="flow-wire-hitarea"
                    />
                  </g>
                  <path
                    d={pathData}
                    className="flow-wire-line"
                    markerEnd="url(#flow-arrow)"
                  />
                  {conn.label && (
                    <g transform={`translate(${midX}, ${midY - 12})`} className="flow-label-badge">
                      <rect x="-42" y="-10" width="84" height="20" rx="4" />
                      <text x="0" y="4" textAnchor="middle">{conn.label}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Temporary wire being dragged */}
            {connectingFromId && (() => {
              const fromPos = getShotPosition(connectingFromId);
              const startX = fromPos.x + NODE_WIDTH;
              const startY = fromPos.y + 120;
              const endX = mouseCanvasPos.x;
              const endY = mouseCanvasPos.y;
              const deltaX = Math.abs(endX - startX) * 0.5;
              const pathData = `M ${startX} ${startY} C ${startX + deltaX} ${startY}, ${endX - deltaX} ${endY}, ${endX} ${endY}`;
              return (
                <path
                  d={pathData}
                  className="flow-wire-dragging"
                  markerEnd="url(#flow-arrow)"
                />
              );
            })()}
          </svg>

          {/* Node Cards */}
          {project.shots.map((shot, index) => {
            const pos = getShotPosition(shot.id);
            const isSelected = selectedShotId === shot.id;
            const activeSlot = shot.slots[0];
            const activeVersion = activeSlot?.versions.find(v => v.id === activeSlot.selectedVersionId) ?? activeSlot?.versions[0];

            // Find preview image if any
            const attachedAsset = project.assets.find(a =>
              a.id === shot.previewAssetId ||
              a.id === activeVersion?.layers.find(l => l.kind === "image" || l.kind === "video")?.assetId
            );

            // Connected characters/environments
            const attachedProfiles = project.referenceProfiles.filter(p => shot.referenceProfileIds.includes(p.id));

            return (
              <div
                key={shot.id}
                className={`storyboard-node-card ${isSelected ? "selected" : ""} status-${shot.status}`}
                style={{
                  transform: `translate(${pos.x}px, ${pos.y}px)`,
                  width: NODE_WIDTH
                }}
                onPointerDown={e => startDragNode(e, shot)}
              >
                {/* Node Input Port (Left) */}
                <div
                  className="port-handle port-input"
                  title="Connect from previous shot"
                  onPointerUp={e => {
                    e.stopPropagation();
                    if (connectingFromId && connectingFromId !== shot.id) {
                      onAddConnection(connectingFromId, shot.id, "Cut");
                      setConnectingFromId(null);
                    }
                  }}
                >
                  <div className="port-dot" />
                </div>

                {/* Node Output Port (Right) */}
                <div
                  className="port-handle port-output"
                  title="Drag wire to connect to next shot"
                  onPointerDown={e => {
                    e.stopPropagation();
                    setConnectingFromId(shot.id);
                  }}
                >
                  <div className="port-dot" />
                </div>

                {/* Card Header */}
                <div className="node-card-header">
                  <div className="node-card-meta">
                    <span className="shot-num-badge">#{index + 1}</span>
                    <select
                      className="shot-type-select"
                      value={shot.shotType || "medium"}
                      onChange={e => onUpdateShot(shot.id, { shotType: e.target.value as Shot["shotType"] })}
                    >
                      <option value="establishing">Wide Establishing</option>
                      <option value="wide">Wide Shot</option>
                      <option value="medium">Medium Shot</option>
                      <option value="close-up">Close-up</option>
                      <option value="extreme-close-up">Extreme Close-up</option>
                      <option value="aerial">Aerial / Drone</option>
                      <option value="point-of-view">POV</option>
                    </select>
                  </div>

                  <div className="node-card-timing">
                    <Clock3 size={12} />
                    <input
                      type="number"
                      className="node-duration-input"
                      value={shot.duration}
                      min="1"
                      step="0.5"
                      onChange={e => onUpdateShot(shot.id, { duration: Math.max(0.5, Number(e.target.value) || 1) })}
                    />
                    <span>s</span>
                  </div>
                </div>

                {/* Editable Title */}
                <input
                  className="node-card-title-input"
                  value={shot.title}
                  placeholder="Shot title..."
                  onChange={e => onUpdateShot(shot.id, { title: e.target.value })}
                />

                {/* Visual / Thumbnail Placeholder */}
                <div className="node-thumbnail-box" onClick={() => handleUploadClick(shot.id)}>
                  {attachedAsset?.path ? (
                    attachedAsset.kind === "video" ? (
                      <video src={attachedAsset.path} className="node-thumb-media" muted />
                    ) : (
                      <img src={attachedAsset.path} alt={shot.title} className="node-thumb-media" />
                    )
                  ) : (
                    <div className="node-thumb-placeholder">
                      <div className="camera-frame-icon">
                        <Video size={24} />
                      </div>
                      <span className="camera-meta-label">
                        {shot.cameraMovement || "Static Camera"}
                      </span>
                      <small className="drop-hint">Click to attach image / video</small>
                    </div>
                  )}

                  <div className="thumb-overlay-badge">
                    <button
                      type="button"
                      className="shot-version-toggle"
                      aria-expanded={expandedVersionShotId === shot.id}
                      onClick={e => {
                        e.stopPropagation();
                        setExpandedVersionShotId(currentId => (currentId === shot.id ? "" : shot.id));
                      }}
                    >
                      <ChevronDown size={11} />
                      <span>{shot.slots.reduce((n, slot) => n + slot.versions.length, 0)} versions</span>
                    </button>
                    {expandedVersionShotId === shot.id && (
                      <div className="shot-version-dropdown" onClick={e => e.stopPropagation()}>
                        {shot.slots.flatMap(slot => slot.versions.map((version, vi) => ({ slot, version, vi }))).map(({ slot, version, vi }) => (
                          <button
                            type="button"
                            key={version.id}
                            className={"shot-version-option" + (version.id === slot.selectedVersionId ? " active" : "")}
                            onClick={() => {
                              onSelectShot(shot.id);
                              onSelectVersion?.(shot.id, slot.id, version.id);
                            }}
                          >
                            <span>{slot.name} · {version.name || "Version " + (vi + 1)}</span>
                            <small>{version.duration}s · {version.layers.length} layers</small>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* AI Prompt Section with Quick Copy */}
                <div className="node-prompt-section">
                  <div className="node-prompt-header">
                    <span className="prompt-label">
                      <Sparkles size={11} color="#d5f36a" /> AI Generation Prompt
                    </span>
                    <button
                      className="prompt-copy-btn"
                      onClick={e => {
                        e.stopPropagation();
                        copyPrompt(shot);
                      }}
                      title="Copy prompt for Midjourney/Runway/Kling/Flux"
                    >
                      {copiedShotId === shot.id ? (
                        <>
                          <Check size={11} color="#d5f36a" /> <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={11} /> <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                  <textarea
                    className="node-prompt-textarea"
                    rows={3}
                    placeholder="Describe the exact visual prompt to generate this shot..."
                    value={shot.generationPrompt || ""}
                    onChange={e => onUpdateShot(shot.id, { generationPrompt: e.target.value })}
                  />
                </div>

                {/* Character & Location Reference Tags */}
                <div className="node-references-section">
                  <div className="reference-badges-list">
                    {attachedProfiles.length > 0 ? (
                      attachedProfiles.map(p => (
                        <span key={p.id} className="ref-tag">
                          {p.entityType === "character" ? "👤" : p.entityType === "environment" ? "🏙️" : "🎨"} {p.name}
                        </span>
                      ))
                    ) : (
                      <span className="ref-tag-empty">No character/style tags</span>
                    )}
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="node-card-footer">
                  <select
                    className="node-status-select"
                    value={shot.status}
                    onChange={e => onUpdateShot(shot.id, { status: e.target.value as Shot["status"] })}
                  >
                    <option value="planned">⚪ Planned</option>
                    <option value="in-progress">🟡 Prompt Ready</option>
                    <option value="ready">🟢 Ready / Generated</option>
                  </select>

                  <div className="node-card-actions">
                    <button
                      type="button"
                      className="node-action-btn"
                      title="Duplicate this shot beat"
                      onClick={() => onDuplicateShot(shot.id)}
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      type="button"
                      className="node-action-btn danger"
                      title="Delete shot"
                      onClick={() => onDeleteShot(shot.id)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
