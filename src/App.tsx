import { invoke } from "@tauri-apps/api/core";
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
import { useEffect, useMemo, useState } from "react";

const sections = [
  { label: "Scan", icon: ScanSearch, active: true },
  { label: "Library", icon: Grid3X3 },
  { label: "Duplicates", icon: Hash },
  { label: "Move/Copy", icon: MoveRight },
  { label: "Settings", icon: Settings }
];

type MediaFile = {
  id: number;
  path: string;
  scanRoot: string;
  filename: string;
  extension: string;
  mediaType: string;
  fileSizeBytes: number;
  fileSizeMb: number;
  createdUnix: number | null;
  modifiedUnix: number | null;
  dateTakenUnix: number | null;
  dateSource: string | null;
  width: number | null;
  height: number | null;
  megapixels: number | null;
  missing: boolean;
  scannedAtUnix: number;
};

type ScanResponse = {
  scannedFiles: number;
  cachedFiles: number;
  skippedUnchanged: number;
  missingFiles: number;
  errors: string[];
};

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
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [extensionInput, setExtensionInput] = useState("");
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [status, setStatus] = useState("Ready");
  const [isScanning, setIsScanning] = useState(false);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    void initializeAppData();
  }, []);

  const extensions = useMemo(
    () =>
      extensionInput
        .split(",")
        .map((extension) => extension.trim().replace(/^\./, "").toLowerCase())
        .filter(Boolean),
    [extensionInput]
  );

  const visibleMediaFiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return mediaFiles;
    }

    return mediaFiles.filter((file) =>
      [file.filename, file.extension, file.mediaType, file.path, file.scanRoot]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [mediaFiles, searchText]);

  async function initializeAppData() {
    try {
      const [defaultExtensions, files] = await Promise.all([
        invoke<string[]>("supported_extensions"),
        invoke<MediaFile[]>("list_media")
      ]);
      setExtensionInput((current) => current || defaultExtensions.join(", "));
      setMediaFiles(files);
      setStatus(files.length ? `Loaded ${files.length.toLocaleString()} cached files` : "Ready to scan");
    } catch (error) {
      setStatus(`Desktop backend unavailable: ${String(error)}`);
    }
  }

  function addScanPath() {
    const nextPath = pathInput.trim();
    if (!nextPath || scanPaths.includes(nextPath)) {
      return;
    }
    setScanPaths((currentPaths) => [...currentPaths, nextPath]);
    setPathInput("");
  }

  function removeScanPath(path: string) {
    setScanPaths((currentPaths) => currentPaths.filter((currentPath) => currentPath !== path));
  }

  async function runScan() {
    if (!scanPaths.length) {
      setStatus("Add at least one folder or drive path before scanning");
      return;
    }

    setIsScanning(true);
    setStatus("Scanning selected paths...");
    try {
      const result = await invoke<ScanResponse>("scan_media", {
        request: { paths: scanPaths, extensions }
      });
      const files = await invoke<MediaFile[]>("list_media");
      setScanResult(result);
      setMediaFiles(files);
      setStatus(
        `Scan complete: ${result.scannedFiles.toLocaleString()} processed, ${result.skippedUnchanged.toLocaleString()} unchanged`
      );
    } catch (error) {
      setStatus(`Scan failed: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

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
          <button className="tag-row">
            <span>No tags yet</span>
            <small>0</small>
          </button>
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
            <button className="secondary-button" onClick={initializeAppData} disabled={isScanning}>
              <RefreshCw size={17} />
              Refresh scan
            </button>
            <button className="primary-button" onClick={runScan} disabled={isScanning}>
              <ScanSearch size={17} />
              {isScanning ? "Scanning" : "Start scan"}
            </button>
          </div>
        </header>

        <section className="summary-grid" aria-label="Library summary">
          <div className="metric">
            <Database size={20} />
            <span>Cached files</span>
            <strong>{mediaFiles.length.toLocaleString()}</strong>
          </div>
          <div className="metric">
            <HardDrive size={20} />
            <span>Scan roots</span>
            <strong>{scanPaths.length}</strong>
          </div>
          <div className="metric">
            <CalendarClock size={20} />
            <span>Status</span>
            <strong>{isScanning ? "Scanning" : "Ready"}</strong>
          </div>
          <div className="metric">
            <Hash size={20} />
            <span>Missing files</span>
            <strong>{scanResult?.missingFiles ?? mediaFiles.filter((file) => file.missing).length}</strong>
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

            <div className="path-form">
              <label>
                Folder or drive path
                <input
                  placeholder="Example: C:\\Users\\Bekka\\Pictures"
                  value={pathInput}
                  onChange={(event) => setPathInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      addScanPath();
                    }
                  }}
                />
              </label>
              <button onClick={addScanPath}>Add path</button>
            </div>

            <div className="tree">
              {scanPaths.length ? (
                scanPaths.map((path) => (
                  <TreeRow key={path} label={folderLabel(path)} path={path} selected expanded>
                    <button className="tree-action" onClick={() => removeScanPath(path)}>
                      Remove path
                    </button>
                  </TreeRow>
                ))
              ) : (
                <div className="empty-state">Add a folder or drive path to begin a real scan.</div>
              )}
            </div>

            <div className="extension-editor">
              <label>
                Included extensions
                <textarea value={extensionInput} onChange={(event) => setExtensionInput(event.target.value)} />
              </label>
            </div>

            <div className="scan-status">
              <strong>{status}</strong>
              {scanResult?.errors.length ? <span>{scanResult.errors.length} scan warnings</span> : null}
            </div>
            {scanResult?.errors.length ? (
              <div className="scan-errors">
                {scanResult.errors.slice(0, 4).map((error) => (
                  <span key={error}>{error}</span>
                ))}
              </div>
            ) : null}
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
                <input
                  placeholder="Search filename, path, tag, type"
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                />
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
              {visibleMediaFiles.length ? (
                visibleMediaFiles.map((item) => (
                  <article className={`media-card ${item.missing ? "missing" : ""}`} key={item.path}>
                    <div className="thumb">
                      <FileImage size={34} />
                      <span>{item.extension.toUpperCase()}</span>
                    </div>
                    <div className="media-card-body">
                      <strong>{item.filename}</strong>
                      <span>
                        {formatDate(item.dateTakenUnix)} - {item.fileSizeMb} MB
                      </span>
                      <span>{formatDimensions(item)}</span>
                      <div className="tag-list">
                        {item.missing ? <span>missing</span> : <span>{item.mediaType}</span>}
                      </div>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state wide">No media files found yet. Add a path and start a scan.</div>
              )}
            </div>

            <div className="data-grid" role="table" aria-label="Detailed media results">
              <div className="data-grid-row header" role="row">
                <span>Name</span>
                <span>Type</span>
                <span>Size</span>
                <span>Date taken</span>
                <span>Path</span>
              </div>
              {visibleMediaFiles.map((item) => (
                <div className="data-grid-row" role="row" key={`${item.path}-row`}>
                  <span>{item.filename}</span>
                  <span>{item.extension.toUpperCase()}</span>
                  <span>{item.fileSizeMb} MB</span>
                  <span>{formatDate(item.dateTakenUnix)}</span>
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

function folderLabel(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function formatDate(unixSeconds: number | null) {
  if (!unixSeconds) {
    return "Unknown date";
  }

  return new Date(unixSeconds * 1000).toLocaleDateString();
}

function formatDimensions(item: MediaFile) {
  if (!item.width || !item.height) {
    return item.dateSource || "Metadata pending";
  }

  return `${item.width} x ${item.height} - ${item.megapixels ?? "?"} MP`;
}

export { App };
