import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  CalendarClock,
  ChevronDown,
  Copy,
  Database,
  FileImage,
  Filter,
  Folder,
  FolderOpen,
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
  tags: string[];
};

type TagSummary = {
  id: number;
  name: string;
  fileCount: number;
};

type ScanResponse = {
  scannedFiles: number;
  cachedFiles: number;
  skippedUnchanged: number;
  missingFiles: number;
  errors: string[];
};

type ScanRoot = {
  path: string;
  enabled: boolean;
  updatedAtUnix: number;
};

type FolderNode = {
  label: string;
  path?: string;
  count: number;
  children: FolderNode[];
};

function TreeRow({ node, depth = 0 }: { node: FolderNode; depth?: number }) {
  const hasChildren = node.children.length > 0;
  return (
    <>
      <div className="tree-row" style={{ paddingLeft: 10 + depth * 18 }}>
        <button className="icon-button small" aria-label="Folder">
          {hasChildren ? <ChevronDown size={16} /> : <Folder size={16} />}
        </button>
        <input type="checkbox" checked readOnly aria-label={`Select ${node.label}`} />
        <div className="tree-copy">
          <span>{node.label}</span>
          {node.path ? <small>{node.path}</small> : null}
        </div>
        <small className="tree-count">{node.count}</small>
      </div>
      {node.children.map((child) => (
        <TreeRow key={child.path ?? `${node.label}-${child.label}`} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

function App() {
  const [scanPaths, setScanPaths] = useState<string[]>([]);
  const [availableExtensions, setAvailableExtensions] = useState<string[]>([]);
  const [selectedExtensions, setSelectedExtensions] = useState<string[]>([]);
  const [fileTypesExpanded, setFileTypesExpanded] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [scanRoots, setScanRoots] = useState<ScanRoot[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [status, setStatus] = useState("Ready");
  const [isScanning, setIsScanning] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);

  useEffect(() => {
    void initializeAppData();
  }, []);

  const extensionGroups = useMemo(() => groupExtensions(availableExtensions), [availableExtensions]);

  const visibleMediaFiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return mediaFiles;
    }

    const tagFilteredFiles = selectedTagFilter
      ? mediaFiles.filter((file) => file.tags.includes(selectedTagFilter))
      : mediaFiles;

    return tagFilteredFiles.filter((file) =>
      [file.filename, file.extension, file.mediaType, file.path, file.scanRoot]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [mediaFiles, searchText, selectedTagFilter]);

  const folderTree = useMemo(() => buildFolderTree(scanPaths, mediaFiles), [scanPaths, mediaFiles]);
  const configuredRootCount = Math.max(scanPaths.length, scanRoots.length);

  async function initializeAppData() {
    try {
      const [defaultExtensions, files, roots, savedTags] = await Promise.all([
        invoke<string[]>("supported_extensions"),
        invoke<MediaFile[]>("list_media"),
        invoke<ScanRoot[]>("list_scan_roots"),
        invoke<TagSummary[]>("list_tags")
      ]);
      setAvailableExtensions(defaultExtensions);
      setSelectedExtensions((current) => (current.length ? current : defaultExtensions));
      setMediaFiles(files);
      setScanRoots(roots);
      setTags(savedTags);
      setScanPaths((current) => (current.length ? current : roots.map((root) => root.path)));
      setStatus(files.length ? `Loaded ${files.length.toLocaleString()} cached files` : "Ready to scan");
    } catch (error) {
      setStatus(`Desktop backend unavailable: ${String(error)}`);
    }
  }

  async function chooseScanFolder() {
    const selected = await open({
      directory: true,
      multiple: true,
      title: "Choose folders or drives to scan"
    });

    const selectedPaths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (!selectedPaths.length) {
      return;
    }

    setScanPaths((currentPaths) => [
      ...currentPaths,
      ...selectedPaths.filter((path) => !currentPaths.includes(path))
    ]);
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
        request: { paths: scanPaths, extensions: selectedExtensions }
      });
      const files = await invoke<MediaFile[]>("list_media");
      const roots = await invoke<ScanRoot[]>("list_scan_roots");
      const savedTags = await invoke<TagSummary[]>("list_tags");
      setScanResult(result);
      setMediaFiles(files);
      setScanRoots(roots);
      setTags(savedTags);
      setSelectedFileIds([]);
      setStatus(
        `Scan complete: ${result.scannedFiles.toLocaleString()} processed, ${result.skippedUnchanged.toLocaleString()} unchanged`
      );
    } catch (error) {
      setStatus(`Scan failed: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  function toggleFileSelection(fileId: number) {
    setSelectedFileIds((currentIds) =>
      currentIds.includes(fileId) ? currentIds.filter((id) => id !== fileId) : [...currentIds, fileId]
    );
  }

  async function applyTagsToSelection() {
    if (!selectedFileIds.length) {
      setStatus("Select one or more files before applying tags");
      return;
    }

    const tagNames = tagInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (!tagNames.length) {
      setStatus("Enter at least one tag");
      return;
    }

    const savedTags = await invoke<TagSummary[]>("apply_tags", {
      request: { fileIds: selectedFileIds, tags: tagNames }
    });
    const files = await invoke<MediaFile[]>("list_media");
    setTags(savedTags);
    setMediaFiles(files);
    setTagInput("");
    setStatus(`Applied ${tagNames.length} tag${tagNames.length === 1 ? "" : "s"} to ${selectedFileIds.length} file(s)`);
  }

  function toggleExtension(extension: string) {
    setSelectedExtensions((current) =>
      current.includes(extension)
        ? current.filter((selected) => selected !== extension)
        : [...current, extension].sort((left, right) => left.localeCompare(right))
    );
  }

  function selectAllExtensions() {
    setSelectedExtensions([...availableExtensions]);
  }

  function deselectAllExtensions() {
    setSelectedExtensions([]);
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
              <button
                className={section.active ? "active" : ""}
                disabled={!section.active}
                title={section.active ? undefined : "This section is not built yet."}
                key={section.label}
              >
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
          <button
            className={`tag-row ${selectedTagFilter === null ? "active-filter" : ""}`}
            onClick={() => setSelectedTagFilter(null)}
          >
            <span>All files</span>
            <small>{mediaFiles.length}</small>
          </button>
          {tags.length ? (
            tags.map((tag) => (
              <button
                className={`tag-row ${selectedTagFilter === tag.name ? "active-filter" : ""}`}
                key={tag.id}
                onClick={() => setSelectedTagFilter(tag.name)}
              >
                <span>{tag.name}</span>
                <small>{tag.fileCount}</small>
              </button>
            ))
          ) : (
            <button className="tag-row" disabled>
              <span>No tags yet</span>
              <small>0</small>
            </button>
          )}
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
            <strong>{configuredRootCount}</strong>
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
              <button disabled title="Folder expansion controls are coming next.">
                Expand all
              </button>
              <button disabled title="Folder expansion controls are coming next.">
                Collapse all
              </button>
              <button disabled title="Folder expansion controls are coming next.">
                Level 1
              </button>
            </div>

            <div className="path-form">
              <div>
                <strong>Scan folders</strong>
                <span>Use the native folder picker to add one or more folders or drives.</span>
              </div>
              <button onClick={chooseScanFolder} disabled={isScanning}>
                <FolderOpen size={16} />
                Choose folder
              </button>
            </div>

            <div className="tree">
              {folderTree.length ? (
                folderTree.map((node) => (
                  <div className="tree-root" key={node.path ?? node.label}>
                    <TreeRow node={node} />
                    {node.path ? (
                      <button className="tree-action" onClick={() => removeScanPath(node.path as string)}>
                        Remove path
                      </button>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="empty-state">Add a folder or drive path to begin a real scan.</div>
              )}
            </div>

            <div className="extension-panel">
              <button
                className="extension-panel-header"
                onClick={() => setFileTypesExpanded((expanded) => !expanded)}
                aria-expanded={fileTypesExpanded}
              >
                <span>
                  <strong>File Types</strong>
                  <small>
                    {selectedExtensions.length} of {availableExtensions.length} enabled
                  </small>
                </span>
                {fileTypesExpanded ? <ChevronDown size={16} /> : <Folder size={16} />}
              </button>
              {fileTypesExpanded ? (
                <div className="extension-panel-body">
                  <div className="extension-actions">
                    <button onClick={selectAllExtensions}>Select all</button>
                    <button onClick={deselectAllExtensions}>Deselect all</button>
                  </div>
                  {extensionGroups.map((group) => (
                    <div className="extension-group" key={group.label}>
                      <strong>{group.label}</strong>
                      <div className="extension-checkboxes">
                        {group.extensions.map((extension) => (
                          <label key={extension}>
                            <input
                              type="checkbox"
                              checked={selectedExtensions.includes(extension)}
                              onChange={() => toggleExtension(extension)}
                            />
                            .{extension}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="scan-status">
              <strong>{status}</strong>
              {scanResult?.errors.length ? <span>{scanResult.errors.length} scan warnings</span> : null}
            </div>
            {scanResult?.errors.length ? (
              <div className="scan-errors">
                <strong>
                  <AlertCircle size={14} />
                  Scan warnings
                </strong>
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
                <button className="icon-button" aria-label="Detailed list" disabled title="View toggle is not built yet.">
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
              <label className="tag-input">
                <Tags size={16} />
                <input
                  placeholder="Add tag(s): family, vacation"
                  value={tagInput}
                  list="known-tags"
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void applyTagsToSelection();
                    }
                  }}
                />
              </label>
              <datalist id="known-tags">
                {tags.map((tag) => (
                  <option value={tag.name} key={tag.id} />
                ))}
              </datalist>
              <button onClick={applyTagsToSelection}>
                <Tags size={16} />
                Apply tag
              </button>
              <button disabled title="Advanced filters are not built yet.">
                <Filter size={16} />
                Filters
              </button>
              <button disabled title="CSV export is not built yet.">
                <Copy size={16} />
                Export CSV
              </button>
            </div>

            <div className="media-grid">
              {visibleMediaFiles.length ? (
                visibleMediaFiles.map((item) => (
                  <article
                    className={`media-card ${item.missing ? "missing" : ""} ${
                      selectedFileIds.includes(item.id) ? "selected" : ""
                    }`}
                    key={item.path}
                    onClick={() => toggleFileSelection(item.id)}
                  >
                    <div className="thumb">
                      <input
                        type="checkbox"
                        checked={selectedFileIds.includes(item.id)}
                        onChange={() => toggleFileSelection(item.id)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Select ${item.filename}`}
                      />
                      <PreviewImage item={item} />
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
                        {item.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
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
                <span>Select</span>
                <span>Name</span>
                <span>Type</span>
                <span>Size</span>
                <span>Date taken</span>
                <span>Path</span>
              </div>
              {visibleMediaFiles.map((item) => (
                <div
                  className={`data-grid-row ${selectedFileIds.includes(item.id) ? "selected" : ""}`}
                  role="row"
                  key={`${item.path}-row`}
                  onClick={() => toggleFileSelection(item.id)}
                >
                  <span>
                    <input
                      type="checkbox"
                      checked={selectedFileIds.includes(item.id)}
                      onChange={() => toggleFileSelection(item.id)}
                      onClick={(event) => event.stopPropagation()}
                      aria-label={`Select ${item.filename}`}
                    />
                  </span>
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

function PreviewImage({ item }: { item: MediaFile }) {
  const [failed, setFailed] = useState(false);
  const canPreview = !item.missing && canPreviewExtension(item.extension);

  if (!canPreview || failed) {
    return <FileImage size={34} />;
  }

  return <img src={convertFileSrc(item.path)} alt="" onError={() => setFailed(true)} loading="lazy" />;
}

function canPreviewExtension(extension: string) {
  return ["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp"].includes(extension.toLowerCase());
}

function buildFolderTree(scanPaths: string[], mediaFiles: MediaFile[]) {
  return scanPaths.map((rootPath) => {
    const root: FolderNode = {
      label: folderLabel(rootPath),
      path: rootPath,
      count: 0,
      children: []
    };

    const filesForRoot = mediaFiles.filter((file) => file.scanRoot === rootPath);
    for (const file of filesForRoot) {
      root.count += 1;
      const relative = relativePath(rootPath, file.path);
      const folderParts = relative.split(/[\\/]/).slice(0, -1).filter(Boolean);
      let current = root;
      let currentPath = rootPath;

      for (const folderPart of folderParts) {
        currentPath = joinDisplayPath(currentPath, folderPart);
        let child = current.children.find((node) => node.label === folderPart);
        if (!child) {
          child = {
            label: folderPart,
            path: currentPath,
            count: 0,
            children: []
          };
          current.children.push(child);
        }
        child.count += 1;
        current = child;
      }
    }

    sortFolderTree(root);
    return root;
  });
}

function sortFolderTree(node: FolderNode) {
  node.children.sort((left, right) => left.label.localeCompare(right.label));
  node.children.forEach(sortFolderTree);
}

function relativePath(rootPath: string, filePath: string) {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "").toLowerCase();
  if (filePath.toLowerCase().startsWith(normalizedRoot)) {
    return filePath.slice(rootPath.replace(/[\\/]+$/, "").length).replace(/^[\\/]/, "");
  }

  return filePath;
}

function joinDisplayPath(parent: string, child: string) {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function groupExtensions(extensions: string[]) {
  const groups = [
    {
      label: "Photos",
      extensions: ["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp", "heic", "heif"]
    },
    {
      label: "Video",
      extensions: ["mov", "m4v", "mp4", "avi", "mkv", "mpg", "mpeg", "webm"]
    },
    {
      label: "RAW / Camera",
      extensions: ["dng", "nef", "nrw", "arw", "srf", "sr2", "cr2", "cr3", "raf", "orf", "rw2", "pef"]
    }
  ];
  const known = new Set(groups.flatMap((group) => group.extensions));
  const custom = extensions.filter((extension) => !known.has(extension));

  return [
    ...groups.map((group) => ({
      ...group,
      extensions: group.extensions.filter((extension) => extensions.includes(extension))
    })),
    custom.length ? { label: "Other", extensions: custom } : null
  ].filter((group): group is { label: string; extensions: string[] } => Boolean(group && group.extensions.length));
}

export { App };
