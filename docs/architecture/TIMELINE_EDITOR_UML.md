# Timeline Editor UML and State Flows

These diagrams define architectural boundaries and data flow, not mandatory React component names.

## Workspace boundary

~~~mermaid
flowchart TB
  Shell[Project Shell / Module Navigation] --> EditorRoute[Timeline Editor]
  Shell --> Planning[Storyboard and References - later]
  subgraph Editor[Timeline Editor Workspace]
    Source[Source Browser: Media / Audio / Text / Effects / Transitions]
    Preview[Preview / Canvas]
    Timeline[Multitrack Timeline]
    Inspector[Selection Inspector]
    Context[Contextual Action Bar]
    Transport[Transport]
    Source -->|insert source command| Timeline
    Timeline -->|selection and playhead| Preview
    Timeline -->|selected entity| Inspector
    Timeline -->|capabilities| Context
    Transport <--> Timeline
    Preview -->|transform command| Timeline
  end
  EditorRoute --> Editor
  Planning -->|explicit source / assembly action| EditorRoute
  Timeline <--> Commands[Typed Edit Commands and Validation]
  Inspector <--> Commands
  Commands <--> Store[Canonical Composition Document]
  Store --> Renderer[Composition Renderer]
  Renderer --> Preview
~~~

## Canonical domain model

~~~mermaid
classDiagram
  class Project {
    +id
    +schemaVersion
    +rootCompositionId
    +assets[]
    +shots[]
  }
  class CompositionDocument {
    +id
    +kind
    +canvasSettings
    +tracks[]
    +placements[]
  }
  class Track {
    +id
    +kind
    +order
    +muted
  }
  class CompositionPlacement {
    +id
    +trackId
    +start
    +duration
    +sourceIn
    +sourceOut
    +sourceRef
    +transform
  }
  class SourceRef {
    +kind
    +assetId
    +versionId
    +compositionId
  }
  class ClipAsset {
    +id
    +versions[]
  }
  class ClipVersion {
    +id
    +compositionDocument
  }
  class Shot {
    +id
    +versions[]
  }
  class ShotVersion {
    +id
    +mediaAssetId
    +provenance
  }
  class EditCommand {
    +type
    +targetIds[]
    +payload
    +validate()
    +apply()
    +invert()
  }
  Project "1" --> "1" CompositionDocument : root
  Project "1" --> "*" ClipAsset : owns
  ClipAsset "1" --> "*" ClipVersion : versions
  Project "1" --> "*" Shot : owns
  Shot "1" --> "*" ShotVersion : alternatives
  CompositionDocument "1" --> "*" Track
  CompositionDocument "1" --> "*" CompositionPlacement
  CompositionPlacement "*" --> "1" Track
  CompositionPlacement "*" --> "1" SourceRef : pinned source
  EditCommand ..> CompositionDocument : validated transaction
~~~

Invariant: each versioned placement pins a concrete source/version. Creating a new Shot Version does not silently repoint existing placements. Legacy arrays are projections during migration, not a second writable truth.

## Edit and Undo sequence

~~~mermaid
sequenceDiagram
  actor User
  participant UI as Timeline UI
  participant Cmd as Command Dispatcher
  participant Doc as Composition Store
  participant History as Undo/Redo
  participant Render as Renderer
  User->>UI: Drag / trim / split / insert / transform
  UI->>Cmd: Typed command and target IDs
  Cmd->>Doc: Validate target, ranges and track constraints
  alt Valid
    Cmd->>History: Capture inverse and history boundary
    Cmd->>Doc: Apply transaction atomically
    Doc-->>Render: Revision changed
    Render-->>UI: Render current playhead
  else Invalid
    Cmd-->>UI: Rejection and actionable reason
    UI-->>User: Preserve prior state
  end
  User->>UI: Undo
  UI->>History: Request inverse command
  History->>Cmd: Apply inverse
  Cmd->>Doc: Validate and apply inverse transaction
~~~

## Mobile contextual state

~~~mermaid
stateDiagram-v2
  [*] --> NoSelection
  NoSelection --> ClipSelected: tap clip
  NoSelection --> TrackSelected: tap track header
  ClipSelected --> ClipActions: resolve clip capabilities
  TrackSelected --> TrackActions: resolve track capabilities
  ClipActions --> ClipSelected: trim / split / duplicate / delete / properties
  TrackActions --> TrackSelected: mute / rename / reorder / add track
  ClipSelected --> NoSelection: clear selection
  TrackSelected --> NoSelection: clear selection
~~~

Mobile bottom controls derive from selection and capabilities; they are not fixed Storyboard / Timeline / Assets / References navigation.

## State ownership

| State | Owner | Persisted? |
|---|---|---|
| Tracks, placements, timing, source pins, transforms, canvas | Canonical Composition | Yes |
| Durable source identity and metadata | Project asset registry | Yes |
| Selection, active source category, inspector, zoom | Editor view state | Usually no |
| Undo/Redo stack and inverses | Command/history service | Not by default |
| Storyboard and Reference Profiles | Planning modules | Yes, never as alternate live timeline |
| Prompt/settings/input snapshots and attempts | Production Task / Generation Run | Yes, immutable per run |

If implementation cannot satisfy a diagram, update the diagram and workspace contract in the same PR as the architectural decision. Do not silently create a parallel model.
