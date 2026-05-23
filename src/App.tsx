import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  FileImage,
  Filter,
  Folder,
  FolderTree,
  Grid3X3,
  HardDrive,
  Hash,
  ListFilter,
  MoveRight,
  RefreshCw,
  ScanSearch,
  Search,
  Settings,
  Tags
} from "lucide-react";

const scanRoots = [
  {
    id: "pictures",
    label: "Pictures",
    path: "C:\\Users\\Bekka\\Pictures",
    selected: true,
    children: [
      { id: "2024", label: "2024", selected: true },
      { id: "2025", label: "2025", selected: false }
    ]
  },
  {
    id: "external",
    label: "External Media Drive",
    path: "E:\\Media Archive",
    selected: true,
    children: [
      { id: "camera", label: "Camera Imports", selected: true },
      { id: "iphone", label: "iPhone Backups", selected: true }
    ]
  }
];

const mediaItems = [
  {
    name: "DSC_1042.NEF",
    type: "RAW",
    date: "2025-10-18",
    size: "42.8 MB",
    dimensions: "6048 x 4024",
    mp: "24.3",
    tags: ["family", "fall"],
    path: "E:\\Media Archive\\Camera Imports\\DSC_1042.NEF"
  },
  {
    name: "IMG_2389.HEIC",
    type: "HEIC",
    date: "2025-11-02",
    size: "3.9 MB",
    dimensions: "4032 x 3024",
    mp: "12.2",
    tags: ["holiday"],
    path: "C:\\Users\\Bekka\\Pictures\\2025\\IMG_2389.HEIC"
  },
  {
    name: "Birthday.mov",
    type: "MOV",
    date: "2024-07-14",
    size: "284.1 MB",
    dimensions: "3840 x 2160",
    mp: "8.3",
    tags: ["birthday", "family"],
    path: "E:\\Media Archive\\iPhone Backups\\Birthday.mov"
  }
];

const tags = [
  { name: "family", count: 482 },
  { name: "holiday", count: 138 },
  { name: "camera import", count: 96 },
  { name: "review", count: 41 }
];

const sections = [
  { label: "Scan", icon: ScanSearch, active: true },
  { label: "Library", icon: Grid3X3 },
  { label: "Duplicates", icon: Hash },
  { label: "Move/Copy", icon: MoveRight },
  { label: "Settings", icon: Settings }
];

function TreeRow({
  label,
  path,
  selected,
  depth = 0,
  expanded = false,
  children
}: {
  label: string;
  path?: string;
  selected: boolean;
  depth?: number;
  expanded?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="tree-row" style={{ paddingLeft: 10 + depth * 18 }}>
        <button className="icon-button small" aria-label={expanded ? "Collapse folder" : "Expand folder"}>
          {children ? expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} /> : <Folder size={16} />}
        </button>
        <input type="checkbox" checked={selected} readOnly aria-label={`Select ${label}`} />
        <div className="tree-copy">
          <span>{label}</span>
          {path ? <small>{path}</small> : null}
        </div>
      </div>
      {expanded ? children : null}
    </>
  );
}

function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <FileImage size={22} />
          </div>
          <div>
            <strong>MediaTagger</strong>
            <span>Photo and video library</span>
          </div>
        </div>

        <nav className="section-nav" aria-label="Application sections">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button className={section.active ? "active" : ""} key={section.label}>
                <Icon size={18} />
                {section.label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-block">
          <div className="block-title">
            <Tags size={16} />
            Tags
          </div>
          {tags.map((tag) => (
            <button className="tag-row" key={tag.name}>
              <span>{tag.name}</span>
              <small>{tag.count}</small>
            </button>
          ))}
        </div>
      </aside>

      <div className="resize-rail" aria-hidden="true" />

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>Scan</h1>
            <p>Choose folders or drives, refresh cached results, and keep missing files visible for review.</p>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button">
              <RefreshCw size={17} />
              Refresh scan
            </button>
            <button className="primary-button">
              <ScanSearch size={17} />
              Start scan
            </button>
          </div>
        </header>

        <section className="summary-grid" aria-label="Library summary">
          <div className="metric">
            <Database size={20} />
            <span>Cached files</span>
            <strong>8,742</strong>
          </div>
          <div className="metric">
            <HardDrive size={20} />
            <span>Scan roots</span>
            <strong>2</strong>
          </div>
          <div className="metric">
            <CalendarClock size={20} />
            <span>Last refresh</span>
            <strong>Today</strong>
          </div>
          <div className="metric">
            <Hash size={20} />
            <span>Duplicate groups</span>
            <strong>Pending</strong>
          </div>
        </section>

        <div className="content-split">
          <section className="panel tree-panel">
            <div className="panel-header">
              <div>
                <h2>Scan Locations</h2>
                <p>Folder tree with bulk selection and level expansion controls.</p>
              </div>
              <FolderTree size={20} />
            </div>
            <div className="toolbar">
              <button>Expand all</button>
              <button>Collapse all</button>
              <button>Level 1</button>
            </div>
            <div className="tree">
              {scanRoots.map((root) => (
                <TreeRow key={root.id} label={root.label} path={root.path} selected={root.selected} expanded>
                  {root.children.map((child) => (
                    <TreeRow key={child.id} label={child.label} selected={child.selected} depth={1} />
                  ))}
                </TreeRow>
              ))}
            </div>
          </section>

          <div className="resize-rail subtle" aria-hidden="true" />

          <section className="panel library-panel">
            <div className="panel-header">
              <div>
                <h2>Library Preview</h2>
                <p>System thumbnails first, fallback icons when unavailable.</p>
              </div>
              <div className="view-actions">
                <button className="icon-button" aria-label="Grid view">
                  <Grid3X3 size={18} />
                </button>
                <button className="icon-button" aria-label="Detailed list">
                  <ListFilter size={18} />
                </button>
              </div>
            </div>

            <div className="filter-row">
              <label>
                <Search size={16} />
                <input placeholder="Search filename, path, tag, type" />
              </label>
              <button>
                <Filter size={16} />
                Filters
              </button>
              <button>
                <Tags size={16} />
                Apply tag
              </button>
              <button>
                <Copy size={16} />
                Export CSV
              </button>
            </div>

            <div className="media-grid">
              {mediaItems.map((item) => (
                <article className="media-card" key={item.path}>
                  <div className="thumb">
                    <FileImage size={34} />
                    <span>{item.type}</span>
                  </div>
                  <div className="media-card-body">
                    <strong>{item.name}</strong>
                    <span>{item.date} · {item.size}</span>
                    <span>{item.dimensions} · {item.mp} MP</span>
                    <div className="tag-list">
                      {item.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <div className="data-grid" role="table" aria-label="Detailed media results">
              <div className="data-grid-row header" role="row">
                <span>Name</span>
                <span>Type</span>
                <span>Size</span>
                <span>Date taken</span>
                <span>Path</span>
              </div>
              {mediaItems.map((item) => (
                <div className="data-grid-row" role="row" key={`${item.path}-row`}>
                  <span>{item.name}</span>
                  <span>{item.type}</span>
                  <span>{item.size}</span>
                  <span>{item.date}</span>
                  <span>{item.path}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export { App };
