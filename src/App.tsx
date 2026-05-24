import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  AlertCircle,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileImage,
  Filter,
  Film,
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
  { label: "Scan", icon: ScanSearch, enabled: true },
  { label: "Library", icon: Grid3X3, enabled: true },
  { label: "Duplicates", icon: Hash, enabled: true },
  { label: "Move/Copy", icon: MoveRight, enabled: true },
  { label: "Settings", icon: Settings, enabled: false }
];

const scanPreviewLimit = 50;
const libraryPageSizes = [25, 50, 100, 200] as const;
const thumbnailSizes = ["small", "medium", "large"] as const;
const thumbnailDimensions = {
  small: { width: 160, height: 110 },
  medium: { width: 220, height: 160 },
  large: { width: 300, height: 220 }
} as const;
const moveLevelOptions = [
  { value: "yearTaken", label: "Year taken" },
  { value: "yearCreated", label: "Year created" },
  { value: "yearModified", label: "Year modified" },
  { value: "monthTaken", label: "Month taken" },
  { value: "monthCreated", label: "Month created" },
  { value: "monthModified", label: "Month modified" },
  { value: "none", label: "None" },
  { value: "fileType", label: "File type" },
  { value: "mediaType", label: "Media type" },
  { value: "primaryTag", label: "Primary tag" },
  { value: "sourceFolder", label: "Source folder" }
] as const;
type AppSection = "Scan" | "Library" | "Duplicates" | "Move/Copy";
type ThumbnailSize = (typeof thumbnailSizes)[number];
type MoveScope = "selected" | "folders" | "all";
type MoveMode = "copy" | "move";
type MoveLevel =
  | "yearTaken"
  | "yearCreated"
  | "yearModified"
  | "monthTaken"
  | "monthCreated"
  | "monthModified"
  | "fileType"
  | "mediaType"
  | "primaryTag"
  | "sourceFolder"
  | "none";

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

type ScanFolder = {
  path: string;
  scanRoot: string;
  missing: boolean;
  lastSeenScanId: number;
};

type FolderNode = {
  label: string;
  path: string;
  count: number;
  children: FolderNode[];
};

type DuplicateGroup = {
  key: string;
  hash: string;
  fileCount: number;
  wastedSizeBytes: number;
  wastedSizeMb: number;
  items: MediaFile[];
};

type DuplicateScanResponse = {
  groups: DuplicateGroup[];
  duplicateFiles: number;
  wastedSizeBytes: number;
  wastedSizeMb: number;
  hashedFiles: number;
};

type MovePreviewItem = {
  id: number;
  sourcePath: string;
  destinationPath: string;
  filename: string;
  reason: string;
};

function TreeRow({
  node,
  depth = 0,
  expandedFolderPaths,
  selectedFolderPaths,
  onToggleExpanded,
  onToggleSelected
}: {
  node: FolderNode;
  depth?: number;
  expandedFolderPaths: string[];
  selectedFolderPaths: string[];
  onToggleExpanded: (node: FolderNode) => void;
  onToggleSelected: (node: FolderNode) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedFolderPaths.includes(node.path);
  const isChecked = selectedFolderPaths.includes(node.path);
  return (
    <>
      <div className="tree-row" style={{ paddingLeft: 10 + depth * 18 }}>
        <button
          className="icon-button small"
          aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
          onClick={() => onToggleExpanded(node)}
          disabled={!hasChildren}
        >
          {hasChildren ? <ChevronDown className={isExpanded ? "" : "chevron-collapsed"} size={16} /> : <Folder size={16} />}
        </button>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={() => onToggleSelected(node)}
          aria-label={`Select ${node.label}`}
        />
        <div className="tree-copy">
          <span>{node.label}</span>
          {node.path ? <small>{node.path}</small> : null}
        </div>
        <small className="tree-count">{node.count}</small>
      </div>
      {isExpanded
        ? node.children.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedFolderPaths={expandedFolderPaths}
              selectedFolderPaths={selectedFolderPaths}
              onToggleExpanded={onToggleExpanded}
              onToggleSelected={onToggleSelected}
            />
          ))
        : null}
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
  const [scanFolders, setScanFolders] = useState<ScanFolder[]>([]);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [status, setStatus] = useState("Ready");
  const [isScanning, setIsScanning] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [selectedFileIds, setSelectedFileIds] = useState<number[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [expandedFolderPaths, setExpandedFolderPaths] = useState<string[]>([]);
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<string[]>([]);
  const [activeSection, setActiveSection] = useState<AppSection>("Scan");
  const [thumbnailSize, setThumbnailSize] = useState<ThumbnailSize>("medium");
  const [libraryPageSize, setLibraryPageSize] = useState<number>(50);
  const [libraryPage, setLibraryPage] = useState<number>(1);
  const [activeMediaId, setActiveMediaId] = useState<number | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(true);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateScanResult, setDuplicateScanResult] = useState<DuplicateScanResponse | null>(null);
  const [activeDuplicateGroupKey, setActiveDuplicateGroupKey] = useState<string | null>(null);
  const [isFindingDuplicates, setIsFindingDuplicates] = useState(false);
  const [moveMode, setMoveMode] = useState<MoveMode>("copy");
  const [moveScope, setMoveScope] = useState<MoveScope>("selected");
  const [moveDestination, setMoveDestination] = useState("");
  const [moveLevelOne, setMoveLevelOne] = useState<MoveLevel>("yearTaken");
  const [moveLevelTwo, setMoveLevelTwo] = useState<MoveLevel>("monthTaken");
  const [moveLevelThree, setMoveLevelThree] = useState<MoveLevel>("fileType");
  const [moveLevelFour, setMoveLevelFour] = useState<MoveLevel>("none");
  const [movePreviewItems, setMovePreviewItems] = useState<MovePreviewItem[]>([]);
  const [moveExpandedFolderPaths, setMoveExpandedFolderPaths] = useState<string[]>([]);
  const [moveSelectedFolderPaths, setMoveSelectedFolderPaths] = useState<string[]>([]);
  const [moveScanPreviewOpen, setMoveScanPreviewOpen] = useState(false);

  useEffect(() => {
    void initializeAppData();
  }, []);

  const extensionGroups = useMemo(() => groupExtensions(availableExtensions), [availableExtensions]);

  const folderTree = useMemo(() => buildFolderTree(scanPaths, scanFolders, mediaFiles), [scanPaths, scanFolders, mediaFiles]);
  const allFolderPaths = useMemo(() => collectNodePaths(folderTree), [folderTree]);
  const selectedFolderSet = useMemo(() => new Set(selectedFolderPaths), [selectedFolderPaths]);
  const activeFolderFilterCount = allFolderPaths.length
    ? selectedFolderPaths.filter((path: string) => allFolderPaths.includes(path)).length
    : 0;
  const activeFileTypeLabel = `${selectedExtensions.length}/${availableExtensions.length || 0} file types`;

  useEffect(() => {
    if (!allFolderPaths.length) {
      return;
    }

    setSelectedFolderPaths((currentPaths) => mergeKnownPaths(currentPaths, allFolderPaths));
    setExpandedFolderPaths((currentPaths) => (currentPaths.length ? currentPaths : scanPaths));
    setMoveSelectedFolderPaths((currentPaths) => mergeKnownPaths(currentPaths, allFolderPaths));
    setMoveExpandedFolderPaths((currentPaths) => (currentPaths.length ? currentPaths : scanPaths));
  }, [allFolderPaths, scanPaths]);

  const visibleMediaFiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const folderFilteredFiles = allFolderPaths.length
      ? mediaFiles.filter((file) => selectedFolderSet.has(fileFolderPath(file.path)))
      : mediaFiles;
    const tagFilteredFiles = selectedTagFilter
      ? folderFilteredFiles.filter((file) => file.tags.includes(selectedTagFilter))
      : folderFilteredFiles;

    if (!query) {
      return tagFilteredFiles;
    }

    return tagFilteredFiles.filter((file) =>
      [file.filename, file.extension, file.mediaType, file.path, file.scanRoot]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [allFolderPaths.length, mediaFiles, searchText, selectedFolderSet, selectedTagFilter]);

  const previewMediaFiles = useMemo(() => visibleMediaFiles.slice(0, scanPreviewLimit), [visibleMediaFiles]);
  const filteredDuplicateGroups = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return duplicateGroups;
    }

    return duplicateGroups.filter((group) =>
      group.items.some((item) =>
        [item.filename, item.extension, item.mediaType, item.path, item.scanRoot, item.tags.join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
    );
  }, [duplicateGroups, searchText]);
  const activeDuplicateGroup = useMemo(
    () =>
      filteredDuplicateGroups.find((group) => group.key === activeDuplicateGroupKey) ??
      filteredDuplicateGroups[0] ??
      null,
    [activeDuplicateGroupKey, filteredDuplicateGroups]
  );
  const duplicateItems = activeDuplicateGroup?.items ?? [];
  const libraryPageCount = Math.max(1, Math.ceil(visibleMediaFiles.length / libraryPageSize));
  const clampedLibraryPage = Math.min(libraryPage, libraryPageCount);
  const libraryPageStart = (clampedLibraryPage - 1) * libraryPageSize;
  const libraryMediaFiles = useMemo(
    () => visibleMediaFiles.slice(libraryPageStart, libraryPageStart + libraryPageSize),
    [libraryPageSize, libraryPageStart, visibleMediaFiles]
  );
  const gridMediaFiles = useMemo(
    () => (activeSection === "Library" ? libraryMediaFiles : visibleMediaFiles.slice(0, 250)),
    [activeSection, libraryMediaFiles, visibleMediaFiles]
  );
  const activePreviewFiles = activeSection === "Library" ? libraryMediaFiles : previewMediaFiles;
  const activePreviewLabel = activeSection === "Library" ? "Library" : "Scan preview";
  const paginationItems = useMemo(
    () => buildPaginationItems(clampedLibraryPage, libraryPageCount),
    [clampedLibraryPage, libraryPageCount]
  );
  const activeThumbnailDimensions = thumbnailDimensions[thumbnailSize];
  const activeMediaCollection = activeSection === "Duplicates" ? duplicateItems : visibleMediaFiles;
  const duplicateItemIds = useMemo(() => duplicateItems.map((item) => item.id), [duplicateItems]);
  const selectedDuplicateCount = useMemo(
    () => duplicateItems.filter((item) => selectedFileIds.includes(item.id)).length,
    [duplicateItems, selectedFileIds]
  );
  const activeMediaItem = useMemo(
    () =>
      activeMediaCollection.find((item) => item.id === activeMediaId) ??
      activeMediaCollection.find((item) => selectedFileIds.includes(item.id)) ??
      activeMediaCollection[0] ??
      null,
    [activeMediaCollection, activeMediaId, selectedFileIds]
  );

  const configuredRootCount = Math.max(scanPaths.length, scanRoots.length);
  const duplicateGroupCount = duplicateGroups.length;
  const duplicateFileCount = duplicateScanResult?.duplicateFiles ?? duplicateGroups.reduce((sum, group) => sum + group.fileCount, 0);
  const duplicateWasteMb =
    duplicateScanResult?.wastedSizeMb ?? duplicateGroups.reduce((sum, group) => sum + group.wastedSizeMb, 0);
  const isBusy = isScanning || isFindingDuplicates;
  const selectedFiles = useMemo(
    () => mediaFiles.filter((item) => selectedFileIds.includes(item.id)),
    [mediaFiles, selectedFileIds]
  );
  const moveSelectedFolderSet = useMemo(() => new Set(moveSelectedFolderPaths), [moveSelectedFolderPaths]);
  const moveSourceFiles = useMemo(() => {
    switch (moveScope) {
      case "selected":
        return selectedFiles;
      case "folders":
        return mediaFiles.filter((item) => moveSelectedFolderSet.has(fileFolderPath(item.path)));
      default:
        return mediaFiles;
    }
  }, [mediaFiles, moveScope, moveSelectedFolderSet, selectedFiles]);
  const moveEligibleFiles = useMemo(
    () => moveSourceFiles.filter((item) => !item.missing),
    [moveSourceFiles]
  );
  const moveSourcePreviewFiles = useMemo(
    () => moveEligibleFiles.slice(0, scanPreviewLimit),
    [moveEligibleFiles]
  );

  useEffect(() => {
    setLibraryPage(1);
  }, [searchText, selectedTagFilter, selectedFolderPaths, activeSection]);

  useEffect(() => {
    if (libraryPage > libraryPageCount) {
      setLibraryPage(libraryPageCount);
    }
  }, [libraryPage, libraryPageCount]);

  useEffect(() => {
    if (!activeMediaCollection.length) {
      setActiveMediaId(null);
      return;
    }

    if (!activeMediaItem) {
      setActiveMediaId(activeMediaCollection[0].id);
    }
  }, [activeMediaCollection, activeMediaItem]);

  useEffect(() => {
    if (!filteredDuplicateGroups.length) {
      setActiveDuplicateGroupKey(null);
      return;
    }

    if (!activeDuplicateGroup) {
      setActiveDuplicateGroupKey(filteredDuplicateGroups[0].key);
    }
  }, [activeDuplicateGroup, filteredDuplicateGroups]);

  async function initializeAppData() {
    try {
      const [defaultExtensions, files, roots, folders, savedTags] = await Promise.all([
        invoke<string[]>("supported_extensions"),
        invoke<MediaFile[]>("list_media"),
        invoke<ScanRoot[]>("list_scan_roots"),
        invoke<ScanFolder[]>("list_scan_folders"),
        invoke<TagSummary[]>("list_tags")
      ]);
      setAvailableExtensions(defaultExtensions);
      setSelectedExtensions((current) => (current.length ? current : defaultExtensions));
      setMediaFiles(files);
      setScanRoots(roots);
      setScanFolders(folders);
      setTags(savedTags);
      setScanPaths((current) => (current.length ? current : roots.map((root) => root.path)));
      const initialTree = buildFolderTree(roots.map((root) => root.path), folders, files);
      setSelectedFolderPaths(collectNodePaths(initialTree));
      setExpandedFolderPaths(roots.map((root) => root.path));
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
    setSelectedFolderPaths((currentPaths) => [...new Set([...currentPaths, ...selectedPaths])]);
    setExpandedFolderPaths((currentPaths) => [...new Set([...currentPaths, ...selectedPaths])]);
  }

  function removeScanPath(path: string) {
    setScanPaths((currentPaths) => currentPaths.filter((currentPath) => currentPath !== path));
  }

  async function runScan(forceRescan = false) {
    if (!scanPaths.length) {
      setStatus("Add at least one folder or drive path before scanning");
      return;
    }

    setIsScanning(true);
    setStatus(forceRescan ? "Running full scan across selected paths..." : "Refreshing selected paths for new, changed, or missing files...");
    try {
      const result = await invoke<ScanResponse>("scan_media", {
        request: { paths: scanPaths, extensions: selectedExtensions, forceRescan }
      });
      const files = await invoke<MediaFile[]>("list_media");
      const roots = await invoke<ScanRoot[]>("list_scan_roots");
      const folders = await invoke<ScanFolder[]>("list_scan_folders");
      const savedTags = await invoke<TagSummary[]>("list_tags");
      setScanResult(result);
      setMediaFiles(files);
      setScanRoots(roots);
      setScanFolders(folders);
      setTags(savedTags);
      setSelectedFileIds([]);
      const nextTree = buildFolderTree(scanPaths, folders, files);
      setSelectedFolderPaths(collectNodePaths(nextTree));
      setExpandedFolderPaths(scanPaths);
      setStatus(
        `${forceRescan ? "Full scan complete" : "Refresh scan complete"}: ${result.scannedFiles.toLocaleString()} processed, ${result.skippedUnchanged.toLocaleString()} unchanged`
      );
    } catch (error) {
      setStatus(`Scan failed: ${String(error)}`);
    } finally {
      setIsScanning(false);
    }
  }

  async function openActiveFileLocation() {
    if (!activeMediaItem) {
      setStatus("Select a file first");
      return;
    }

    try {
      await invoke("open_file_location", { path: activeMediaItem.path });
      setStatus(`Opened location for ${activeMediaItem.filename}`);
    } catch (error) {
      setStatus(`Open location failed: ${String(error)}`);
    }
  }

  async function openActiveFile() {
    if (!activeMediaItem) {
      setStatus("Select a file first");
      return;
    }

    try {
      await invoke("open_file_path", { path: activeMediaItem.path });
      setStatus(`Opened ${activeMediaItem.filename}`);
    } catch (error) {
      setStatus(`Open file failed: ${String(error)}`);
    }
  }

  async function exportDuplicateCsv() {
    if (!filteredDuplicateGroups.length) {
      setStatus("No duplicate groups are available to export");
      return;
    }

    const rows = filteredDuplicateGroups.flatMap((group, groupIndex) =>
      group.items.map((item, itemIndex) => ({
        groupNumber: groupIndex + 1,
        hash: group.hash,
        fileCount: group.fileCount,
        wastedSizeMb: group.wastedSizeMb.toFixed(1),
        wastedSizeBytes: group.wastedSizeBytes,
        duplicateRank: itemIndex + 1,
        filename: item.filename,
        extension: item.extension.toUpperCase(),
        mediaType: formatMediaType(item.mediaType),
        fileSizeMb: item.fileSizeMb,
        dateTaken: formatDate(item.dateTakenUnix),
        scanRoot: item.scanRoot,
        path: item.path,
        tags: item.tags.join(", "),
        missing: item.missing ? "Yes" : "No"
      }))
    );

    const headers = [
      "Group #",
      "Hash",
      "Files In Group",
      "Reclaimable MB",
      "Reclaimable Bytes",
      "Duplicate Rank",
      "Filename",
      "Extension",
      "Media Type",
      "File Size MB",
      "Date Taken",
      "Scan Root",
      "Path",
      "Tags",
      "Missing"
    ];

    const csvLines = [
      headers.join(","),
      ...rows.map((row) =>
        [
          row.groupNumber,
          row.hash,
          row.fileCount,
          row.wastedSizeMb,
          row.wastedSizeBytes,
          row.duplicateRank,
          row.filename,
          row.extension,
          row.mediaType,
          row.fileSizeMb,
          row.dateTaken,
          row.scanRoot,
          row.path,
          row.tags,
          row.missing
        ]
          .map((value) => csvEscape(String(value ?? "")))
          .join(",")
      )
    ];

    const filePath = await save({
      title: "Export duplicate report",
      defaultPath: `duplicate-report-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });

    if (!filePath) {
      return;
    }

    try {
      await invoke("save_text_report", { path: filePath, contents: csvLines.join("\n") });
      setStatus(`Exported ${filteredDuplicateGroups.length.toLocaleString()} duplicate group(s) to CSV`);
    } catch (error) {
      setStatus(`CSV export failed: ${String(error)}`);
    }
  }

  async function chooseMoveDestination() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose destination folder"
    });

    if (typeof selected === "string" && selected.trim()) {
      setMoveDestination(selected);
      setStatus(`Destination selected: ${selected}`);
    }
  }

  function buildMovePreview() {
    if (!moveDestination.trim()) {
      setStatus("Choose a destination folder before building the preview");
      return;
    }

    if (!moveEligibleFiles.length) {
      setStatus("No eligible files are available for the selected source scope");
      return;
    }

    const previewItems = moveEligibleFiles.map((item) => {
      const segments = buildMoveSegments(item, [moveLevelOne, moveLevelTwo, moveLevelThree, moveLevelFour]);
      const destinationPath = joinPathParts(moveDestination, ...segments, item.filename);
      return {
        id: item.id,
        sourcePath: item.path,
        destinationPath,
        filename: item.filename,
        reason: `${moveMode === "copy" ? "Copy" : "Move"} via ${segments.join(" / ")}`
      };
    });

    setMovePreviewItems(previewItems);
    setStatus(`Built ${previewItems.length.toLocaleString()} ${moveMode} preview item(s)`);
  }

  async function runDuplicateScan() {
    setIsFindingDuplicates(true);
    setStatus("Checking for exact duplicates...");
    try {
      const result = await invoke<DuplicateScanResponse>("find_duplicates");
      setDuplicateGroups(result.groups);
      setDuplicateScanResult(result);
      setActiveDuplicateGroupKey(result.groups[0]?.key ?? null);
      setSelectedFileIds([]);
      setStatus(
        result.groups.length
          ? `Found ${result.groups.length.toLocaleString()} duplicate groups across ${result.duplicateFiles.toLocaleString()} files`
          : "No exact duplicates found"
      );
    } catch (error) {
      setStatus(`Duplicate check failed: ${String(error)}`);
    } finally {
      setIsFindingDuplicates(false);
    }
  }

  function toggleFileSelection(fileId: number) {
    setSelectedFileIds((currentIds) =>
      currentIds.includes(fileId) ? currentIds.filter((id) => id !== fileId) : [...currentIds, fileId]
    );
  }

  function activateMediaFile(fileId: number) {
    setActiveMediaId(fileId);
    toggleFileSelection(fileId);
  }

  function selectDuplicateGroup() {
    if (!duplicateItemIds.length) {
      setStatus("Select a duplicate group first");
      return;
    }

    setSelectedFileIds((currentIds) => [...new Set([...currentIds, ...duplicateItemIds])]);
    setStatus(`Selected ${duplicateItemIds.length.toLocaleString()} file(s) in the active duplicate group`);
  }

  function clearDuplicateGroupSelection() {
    if (!duplicateItemIds.length) {
      setStatus("Select a duplicate group first");
      return;
    }

    setSelectedFileIds((currentIds) => currentIds.filter((id) => !duplicateItemIds.includes(id)));
    setStatus("Cleared duplicate group selection");
  }

  function keepActiveDuplicate() {
    if (!duplicateItems.length || !activeMediaItem || !duplicateItemIds.includes(activeMediaItem.id)) {
      setStatus("Select a duplicate item to keep first");
      return;
    }

    const otherIds = duplicateItemIds.filter((id) => id !== activeMediaItem.id);
    setSelectedFileIds((currentIds) => [...new Set([...currentIds.filter((id) => !duplicateItemIds.includes(id)), ...otherIds])]);
    setStatus(
      `Marked ${otherIds.length.toLocaleString()} duplicate file(s) as extras while keeping ${activeMediaItem.filename}`
    );
  }

  function sendDuplicateSelectionToMoveCopy() {
    const duplicateSelectionIds = duplicateItems
      .filter((item) => selectedFileIds.includes(item.id))
      .map((item) => item.id);

    if (!duplicateSelectionIds.length) {
      setStatus("Select one or more duplicate files first");
      return;
    }

    setSelectedFileIds(duplicateSelectionIds);
    setMoveScope("selected");
    setActiveSection("Move/Copy");
    setStatus(`Sent ${duplicateSelectionIds.length.toLocaleString()} duplicate file(s) to Move/Copy`);
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
    if (duplicateScanResult) {
      const refreshedDuplicates = await invoke<DuplicateScanResponse>("find_duplicates");
      setDuplicateGroups(refreshedDuplicates.groups);
      setDuplicateScanResult(refreshedDuplicates);
    }
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

  function expandAllFolders() {
    setExpandedFolderPaths(allFolderPaths);
  }

  function collapseAllFolders() {
    setExpandedFolderPaths([]);
  }

  function expandTopLevelFolders() {
    setExpandedFolderPaths(scanPaths);
  }

  function selectAllFolders() {
    setSelectedFolderPaths(allFolderPaths);
  }

  function deselectAllFolders() {
    setSelectedFolderPaths([]);
  }

  function toggleFolderExpanded(node: FolderNode) {
    setExpandedFolderPaths((currentPaths) =>
      currentPaths.includes(node.path)
        ? currentPaths.filter((path) => path !== node.path)
        : [...currentPaths, node.path]
    );
  }

  function toggleFolderSelected(node: FolderNode) {
    const nodePaths = collectNodePaths([node]);
    const shouldDeselect = nodePaths.every((path) => selectedFolderPaths.includes(path));
    setSelectedFolderPaths((currentPaths) =>
      shouldDeselect
        ? currentPaths.filter((path) => !nodePaths.includes(path))
        : [...new Set([...currentPaths, ...nodePaths])]
    );
  }

  function expandAllMoveFolders() {
    setMoveExpandedFolderPaths(allFolderPaths);
  }

  function collapseAllMoveFolders() {
    setMoveExpandedFolderPaths([]);
  }

  function expandTopLevelMoveFolders() {
    setMoveExpandedFolderPaths(scanPaths);
  }

  function selectAllMoveFolders() {
    setMoveSelectedFolderPaths(allFolderPaths);
  }

  function deselectAllMoveFolders() {
    setMoveSelectedFolderPaths([]);
  }

  function toggleMoveFolderExpanded(node: FolderNode) {
    setMoveExpandedFolderPaths((currentPaths) =>
      currentPaths.includes(node.path)
        ? currentPaths.filter((path) => path !== node.path)
        : [...currentPaths, node.path]
    );
  }

  function toggleMoveFolderSelected(node: FolderNode) {
    const nodePaths = collectNodePaths([node]);
    const shouldDeselect = nodePaths.every((path) => moveSelectedFolderPaths.includes(path));
    setMoveSelectedFolderPaths((currentPaths) =>
      shouldDeselect
        ? currentPaths.filter((path) => !nodePaths.includes(path))
        : [...new Set([...currentPaths, ...nodePaths])]
    );
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
            const isActive = activeSection === section.label;
            return (
              <button
                className={isActive ? "active" : ""}
                disabled={!section.enabled}
                title={section.enabled ? undefined : "This section is not built yet."}
                key={section.label}
                onClick={() => {
                  if (section.enabled) {
                    setActiveSection(section.label as AppSection);
                  }
                }}
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
            <h1>{activeSection}</h1>
            <p>
              {activeSection === "Scan"
                ? "Choose folders or drives, refresh cached results, and keep missing files visible for review."
                : activeSection === "Library"
                  ? "Browse the full visible library, review previews, and apply tags from one place."
                  : activeSection === "Duplicates"
                    ? "Find exact duplicate files, review each group, and compare paths before any cleanup work."
                    : "Build a safe move or copy plan, choose a destination, and preview the resulting folder structure."}
            </p>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" onClick={initializeAppData} disabled={isBusy}>
              <RefreshCw size={17} />
              Reload library
            </button>
            <button
              className="secondary-button"
              onClick={() => runScan(false)}
              disabled={isBusy || activeSection === "Duplicates"}
              title={activeSection === "Duplicates" ? "Refresh scan is available from Scan, Library, or Move/Copy." : undefined}
            >
              <RefreshCw size={17} />
              Refresh scan
            </button>
            <button
              className="primary-button"
              onClick={
                activeSection === "Duplicates"
                  ? runDuplicateScan
                  : activeSection === "Move/Copy"
                    ? buildMovePreview
                    : () => runScan(true)
              }
              disabled={isBusy}
            >
              {activeSection === "Duplicates" ? (
                <Hash size={17} />
              ) : activeSection === "Move/Copy" ? (
                <MoveRight size={17} />
              ) : (
                <ScanSearch size={17} />
              )}
              {activeSection === "Duplicates"
                ? isFindingDuplicates
                  ? "Checking duplicates"
                  : "Find duplicates"
                : activeSection === "Move/Copy"
                  ? "Build preview"
                  : isScanning
                    ? "Scanning"
                    : "Start scan"}
            </button>
          </div>
        </header>

        <section className="summary-grid" aria-label="Library summary">
          <div className="metric">
            <Database size={20} />
            <span>{activeSection === "Duplicates" ? "Duplicate groups" : activeSection === "Move/Copy" ? "Planned files" : "Cached files"}</span>
            <strong>
              {(activeSection === "Duplicates"
                ? duplicateGroupCount
                : activeSection === "Move/Copy"
                  ? movePreviewItems.length || moveEligibleFiles.length
                  : mediaFiles.length).toLocaleString()}
            </strong>
          </div>
          <div className="metric">
            <HardDrive size={20} />
            <span>{activeSection === "Duplicates" ? "Duplicate files" : activeSection === "Move/Copy" ? "Source scope" : "Scan roots"}</span>
            <strong>
              {activeSection === "Duplicates"
                ? duplicateFileCount.toLocaleString()
                : activeSection === "Move/Copy"
                  ? moveScope
                  : configuredRootCount}
            </strong>
          </div>
          <div className="metric">
            <CalendarClock size={20} />
            <span>Status</span>
            <strong>{isScanning ? "Scanning" : isFindingDuplicates ? "Reviewing" : "Ready"}</strong>
          </div>
          <div className="metric">
            <Hash size={20} />
            <span>{activeSection === "Duplicates" ? "Potential space saved" : activeSection === "Move/Copy" ? "Destination" : "Missing files"}</span>
            <strong>
              {activeSection === "Duplicates"
                ? `${duplicateWasteMb.toFixed(1)} MB`
                : activeSection === "Move/Copy"
                  ? moveDestination
                    ? folderLabel(moveDestination)
                    : "Not set"
                : (scanResult?.missingFiles ?? mediaFiles.filter((file) => file.missing).length)}
            </strong>
          </div>
        </section>

        <div className="content-split">
          {activeSection === "Move/Copy" ? (
            <>
              <div className="move-left-column">
                <section className="panel tree-panel move-plan-panel">
                  <div className="panel-header">
                    <div>
                      <h2>Plan Setup</h2>
                      <p>Choose the source scope, destination, and folder structure before previewing any file operations.</p>
                    </div>
                    <MoveRight size={20} />
                  </div>

                  <div className="planner-scroll">
                    <div className="planner-section">
                      <strong>Source scope</strong>
                      <div className="planner-choice-list">
                        <label>
                          <input type="radio" checked={moveScope === "selected"} onChange={() => setMoveScope("selected")} />
                          Selected files ({selectedFiles.length})
                        </label>
                        <label>
                          <input type="radio" checked={moveScope === "folders"} onChange={() => setMoveScope("folders")} />
                          Selected folders in this tab ({moveSelectedFolderPaths.length})
                        </label>
                        <label>
                          <input type="radio" checked={moveScope === "all"} onChange={() => setMoveScope("all")} />
                          All cached files ({mediaFiles.length})
                        </label>
                      </div>
                    </div>

                    <div className="planner-section">
                      <strong>Source folders</strong>
                      <div className="toolbar planner-toolbar">
                        <button onClick={expandAllMoveFolders} disabled={!folderTree.length}>
                          Expand all
                        </button>
                        <button onClick={collapseAllMoveFolders} disabled={!folderTree.length}>
                          Collapse all
                        </button>
                        <button onClick={expandTopLevelMoveFolders} disabled={!folderTree.length}>
                          Level 1
                        </button>
                        <button onClick={selectAllMoveFolders} disabled={!folderTree.length}>
                          Select all
                        </button>
                        <button onClick={deselectAllMoveFolders} disabled={!folderTree.length}>
                          Deselect
                        </button>
                      </div>
                      <div className="planner-tree">
                        {folderTree.length ? (
                          folderTree.map((node) => (
                            <div className="tree-root" key={`move-${node.path}`}>
                              <TreeRow
                                node={node}
                                expandedFolderPaths={moveExpandedFolderPaths}
                                selectedFolderPaths={moveSelectedFolderPaths}
                                onToggleExpanded={toggleMoveFolderExpanded}
                                onToggleSelected={toggleMoveFolderSelected}
                              />
                            </div>
                          ))
                        ) : (
                          <div className="empty-state">Add scan locations first to choose source folders here.</div>
                        )}
                      </div>
                    </div>

                    <div className="planner-section">
                      <strong>Action</strong>
                      <div className="planner-toggle">
                        <button className={moveMode === "copy" ? "active" : ""} onClick={() => setMoveMode("copy")}>
                          Copy
                        </button>
                        <button className={moveMode === "move" ? "active" : ""} onClick={() => setMoveMode("move")}>
                          Move
                        </button>
                      </div>
                    </div>

                    <div className="planner-section">
                      <strong>Destination</strong>
                      <div className="planner-destination">
                        <div>
                          <span>{moveDestination || "No destination selected yet"}</span>
                        </div>
                        <button onClick={chooseMoveDestination}>
                          <FolderOpen size={16} />
                          Choose folder
                        </button>
                      </div>
                    </div>

                    <div className="planner-section">
                      <strong>Folder structure</strong>
                      <div className="planner-note-inline">Choose up to four folder levels in any order. Default is Year taken, Month taken, File type.</div>
                      <div className="planner-grid">
                        <label>
                          <span>Level 1</span>
                          <select value={moveLevelOne} onChange={(event) => setMoveLevelOne(event.target.value as MoveLevel)}>
                            {moveLevelOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Level 2</span>
                          <select value={moveLevelTwo} onChange={(event) => setMoveLevelTwo(event.target.value as MoveLevel)}>
                            {moveLevelOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Level 3</span>
                          <select value={moveLevelThree} onChange={(event) => setMoveLevelThree(event.target.value as MoveLevel)}>
                            {moveLevelOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Level 4</span>
                          <select value={moveLevelFour} onChange={(event) => setMoveLevelFour(event.target.value as MoveLevel)}>
                            {moveLevelOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>

                    <div className="panel-note">
                      <strong>{moveEligibleFiles.length.toLocaleString()} eligible files</strong>
                      <span>{movePreviewItems.length ? `${movePreviewItems.length.toLocaleString()} preview rows built` : "Build preview to inspect source and destination paths."}</span>
                    </div>
                  </div>
                </section>

                <section className={`panel move-scan-preview-panel ${moveScanPreviewOpen ? "" : "collapsed"}`}>
                  <div className="panel-header">
                    <div>
                      <h2>Scan preview</h2>
                      <p>Preview the first source files selected for this move or copy plan.</p>
                    </div>
                    <div className="view-actions">
                      <button
                        className="icon-button"
                        aria-label={moveScanPreviewOpen ? "Hide scan preview" : "Show scan preview"}
                        title={moveScanPreviewOpen ? "Hide scan preview" : "Show scan preview"}
                        onClick={() => setMoveScanPreviewOpen((open) => !open)}
                      >
                        {moveScanPreviewOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>
                    </div>
                  </div>
                  {moveScanPreviewOpen ? (
                    <>
                      <div className="panel-note">
                        <strong>{moveSourcePreviewFiles.length.toLocaleString()} preview files</strong>
                        <span>Showing the first {Math.min(scanPreviewLimit, moveEligibleFiles.length).toLocaleString()} eligible files from this plan source.</span>
                      </div>
                      <div className="media-grid move-source-grid">
                        {moveSourcePreviewFiles.length ? (
                          moveSourcePreviewFiles.map((item) => (
                            <article
                              className={`media-card ${item.missing ? "missing" : ""} ${
                                selectedFileIds.includes(item.id) ? "selected" : ""
                              } ${activeMediaItem?.id === item.id ? "active-item" : ""}`}
                              key={`move-preview-${item.path}`}
                              onClick={() => activateMediaFile(item.id)}
                              title={`${item.filename} | ${item.path}`}
                              style={{
                                width: `${activeThumbnailDimensions.width}px`,
                                height: `${activeThumbnailDimensions.height}px`
                              }}
                            >
                              <div
                                className="thumb"
                                style={{
                                  width: `${activeThumbnailDimensions.width}px`,
                                  height: `${activeThumbnailDimensions.height}px`,
                                  minHeight: `${activeThumbnailDimensions.height}px`
                                }}
                              >
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
                            </article>
                          ))
                        ) : (
                          <div className="empty-state wide">No source files are currently available for preview.</div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="move-preview-collapsed">Scan preview hidden. Expand it if you want to spot-check source files.</div>
                  )}
                </section>
              </div>

              <div className="resize-rail subtle" aria-hidden="true" />

              <section className="panel library-panel move-preview-panel">
                <div className="panel-header">
                  <div>
                    <h2>Move/Copy Preview</h2>
                    <p>Review where each file would land before any real file operations are enabled.</p>
                  </div>
                  <div className="view-actions">
                    <button disabled title="Execution is not built yet.">
                      <MoveRight size={16} />
                      Execute later
                    </button>
                  </div>
                </div>

                <div className="panel-note">
                  <strong>{moveMode === "copy" ? "Copy" : "Move"} preview</strong>
                  <span>
                    {moveDestination
                      ? `Destination root: ${moveDestination}`
                      : "Choose a destination folder, then build the preview."}
                  </span>
                </div>

                <div className="move-preview-table data-grid" role="table" aria-label="Move copy preview">
                  <div className="data-grid-row header move-preview-row" role="row">
                    <span>Name</span>
                    <span>Action</span>
                    <span>Source</span>
                    <span>Destination</span>
                  </div>
                  {movePreviewItems.length ? (
                    movePreviewItems.map((item) => (
                      <div className="data-grid-row move-preview-row" role="row" key={`${item.id}-${item.destinationPath}`}>
                        <span>{item.filename}</span>
                        <span>{item.reason}</span>
                        <span>{item.sourcePath}</span>
                        <span>{item.destinationPath}</span>
                      </div>
                    ))
                  ) : (
                    <div className="empty-state wide">No preview built yet. Choose a destination and click Build preview.</div>
                  )}
                </div>
              </section>
            </>
          ) : null}
          {activeSection === "Duplicates" ? (
            <>
              <section className="panel tree-panel duplicate-groups-panel">
                <div className="panel-header">
                  <div>
                    <h2>Duplicate Groups</h2>
                    <p>Exact matches are grouped by content hash so you can review path-by-path before cleanup.</p>
                  </div>
                  <Hash size={20} />
                </div>
                <div className="panel-note">
                  <strong>{filteredDuplicateGroups.length.toLocaleString()} groups in view</strong>
                  <span>{duplicateFileCount.toLocaleString()} duplicate files found so far</span>
                </div>
                <div className="duplicate-group-list">
                  {filteredDuplicateGroups.length ? (
                    filteredDuplicateGroups.map((group) => (
                      <button
                        className={`duplicate-group-card ${activeDuplicateGroup?.key === group.key ? "active" : ""}`}
                        key={group.key}
                        onClick={() => {
                          setActiveDuplicateGroupKey(group.key);
                          setActiveMediaId(group.items[0]?.id ?? null);
                        }}
                      >
                        <div className="duplicate-group-top">
                          <strong>{group.fileCount} matching files</strong>
                          <span>{formatFileSize(group.wastedSizeBytes)} reclaimable</span>
                        </div>
                        <small>{group.items[0]?.filename ?? "Duplicate group"}</small>
                        <small>{group.items[0]?.scanRoot ?? group.items[0]?.path ?? ""}</small>
                      </button>
                    ))
                  ) : (
                    <div className="empty-state wide">
                      {duplicateScanResult ? "No duplicate groups match the current search." : "Run Find duplicates to build the review list."}
                    </div>
                  )}
                </div>
              </section>

              <div className="resize-rail subtle" aria-hidden="true" />

              <section className="panel library-panel duplicate-review-panel">
                <div className="panel-header">
                  <div>
                    <h2>Duplicate Review</h2>
                    <p>
                      {activeDuplicateGroup
                        ? `Compare ${activeDuplicateGroup.fileCount} exact matches before deciding what to keep.`
                        : "Select a duplicate group to review its matching files."}
                    </p>
                  </div>
                  <div className="view-actions">
                    <button className="icon-button" aria-label="Grid view" title="Grid view">
                      <Grid3X3 size={18} />
                    </button>
                    <div className="size-toggle" aria-label="Thumbnail size">
                      {thumbnailSizes.map((size) => (
                        <button
                          className={thumbnailSize === size ? "active" : ""}
                          key={size}
                          onClick={() => setThumbnailSize(size)}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                    <button
                      className="icon-button"
                      aria-label={detailPanelOpen ? "Hide details panel" : "Show details panel"}
                      title={detailPanelOpen ? "Hide details panel" : "Show details panel"}
                      onClick={() => setDetailPanelOpen((open) => !open)}
                    >
                      {detailPanelOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
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
                  <button onClick={() => void exportDuplicateCsv()} disabled={!filteredDuplicateGroups.length}>
                    <Copy size={16} />
                    Export CSV
                  </button>
                </div>

                <div className="toolbar duplicate-selection-toolbar">
                  <button onClick={selectDuplicateGroup} disabled={!duplicateItems.length}>
                    Select group
                  </button>
                  <button onClick={keepActiveDuplicate} disabled={!duplicateItems.length || !activeMediaItem}>
                    Keep active
                  </button>
                  <button onClick={sendDuplicateSelectionToMoveCopy} disabled={!selectedDuplicateCount}>
                    <MoveRight size={16} />
                    Send to Move/Copy
                  </button>
                  <button onClick={clearDuplicateGroupSelection} disabled={!selectedDuplicateCount}>
                    Clear group
                  </button>
                  <span className="duplicate-selection-note">
                    {selectedDuplicateCount.toLocaleString()} selected in this group
                  </span>
                </div>

                <div className={`library-workbench duplicate-review-workbench ${detailPanelOpen ? "" : "details-collapsed"}`}>
                  <div className="library-main duplicate-review-main">
                    <div className="duplicate-group-summary">
                      <span>Hash</span>
                      <strong>{activeDuplicateGroup ? activeDuplicateGroup.hash.slice(0, 16) : "No group selected"}</strong>
                      {activeDuplicateGroup ? <small>{activeDuplicateGroup.hash}</small> : null}
                    </div>
                    <div className="media-grid library-grid duplicate-review-grid">
                      {duplicateItems.length ? (
                        duplicateItems.map((item) => (
                          <article
                            className={`media-card ${item.missing ? "missing" : ""} ${
                              selectedFileIds.includes(item.id) ? "selected" : ""
                            } ${activeMediaItem?.id === item.id ? "active-item" : ""}`}
                            key={`${activeDuplicateGroup?.key}-${item.path}`}
                            onClick={() => activateMediaFile(item.id)}
                            title={`${item.filename} | ${item.path}`}
                            style={{
                              width: `${activeThumbnailDimensions.width}px`,
                              height: `${activeThumbnailDimensions.height}px`
                            }}
                          >
                            <div
                              className="thumb"
                              style={{
                                width: `${activeThumbnailDimensions.width}px`,
                                height: `${activeThumbnailDimensions.height}px`,
                                minHeight: `${activeThumbnailDimensions.height}px`
                              }}
                            >
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
                          </article>
                        ))
                      ) : (
                        <div className="empty-state wide">
                          {duplicateScanResult ? "No files are currently selected for duplicate review." : "Run Find duplicates to load exact match groups."}
                        </div>
                      )}
                    </div>

                    <div className="data-grid duplicate-review-table" role="table" aria-label="Duplicate review results">
                      <div className="data-grid-row header duplicate-grid-row" role="row">
                        <span>Select</span>
                        <span>Name</span>
                        <span>Type</span>
                        <span>Size</span>
                        <span>Date taken</span>
                        <span>Path</span>
                        <span>Tags</span>
                      </div>
                      {duplicateItems.map((item) => (
                        <div
                          className={`data-grid-row duplicate-grid-row ${selectedFileIds.includes(item.id) ? "selected" : ""}`}
                          role="row"
                          key={`${item.path}-duplicate-row`}
                          onClick={() => activateMediaFile(item.id)}
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
                          <span>{item.tags.join(", ") || "No tags"}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {detailPanelOpen ? (
                    <aside className="detail-panel">
                      <div className="detail-panel-header">
                        <strong>Details</strong>
                        <button
                          className="icon-button small"
                          aria-label="Collapse details panel"
                          title="Collapse details panel"
                          onClick={() => setDetailPanelOpen(false)}
                        >
                          <ChevronUp size={16} />
                        </button>
                      </div>
                      {activeMediaItem ? (
                        <>
                          <div className="detail-preview">
                            <DetailPreview item={activeMediaItem} />
                          </div>
                          <div className="detail-copy">
                            <strong>{activeMediaItem.filename}</strong>
                            <span>{activeMediaItem.path}</span>
                          </div>
                          <div className="detail-section">
                            <div className="detail-row">
                              <span><FileImage size={14} /> Type</span>
                              <strong>{activeMediaItem.extension.toUpperCase()} / {formatMediaType(activeMediaItem.mediaType)}</strong>
                            </div>
                            <div className="detail-row">
                              <span><HardDrive size={14} /> File size</span>
                              <strong>{activeMediaItem.fileSizeMb} MB</strong>
                            </div>
                            <div className="detail-row">
                              <span><CalendarClock size={14} /> Date taken</span>
                              <strong>{formatDate(activeMediaItem.dateTakenUnix)}</strong>
                            </div>
                            <div className="detail-row">
                              <span><Folder size={14} /> Folder</span>
                              <strong>{fileFolderPath(activeMediaItem.path)}</strong>
                            </div>
                          </div>
                          <div className="detail-section">
                            <span className="detail-label">Duplicate group</span>
                            <div className="detail-meta-note">
                              {activeDuplicateGroup?.fileCount ?? 0} matching files with {formatFileSize(activeDuplicateGroup?.wastedSizeBytes ?? 0)} potentially reclaimable.
                            </div>
                          </div>
                          <div className="detail-section">
                            <span className="detail-label">Actions</span>
                            <div className="detail-actions">
                              <button onClick={openActiveFile}>
                                <FileImage size={16} />
                                Open file
                              </button>
                              <button onClick={openActiveFileLocation}>
                                <FolderOpen size={16} />
                                Open location
                              </button>
                            </div>
                          </div>
                          <div className="detail-section">
                            <span className="detail-label">Tags</span>
                            <div className="detail-tag-list">
                              {activeMediaItem.tags.length ? (
                                activeMediaItem.tags.map((tag) => <span key={tag}>{tag}</span>)
                              ) : (
                                <span className="detail-empty">No tags yet</span>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="detail-empty-state">Select a duplicate item to inspect it here.</div>
                      )}
                    </aside>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}
          {activeSection === "Scan" || activeSection === "Library" ? (
            <>
          <section className="panel tree-panel">
            <div className="panel-header">
              <div>
                <h2>{activeSection === "Scan" ? "Scan Locations" : "Library Folders"}</h2>
                <p>
                  {activeSection === "Scan"
                    ? "Folder tree with bulk selection and level expansion controls."
                    : "Use the folder tree to narrow the library and browse one branch at a time."}
                </p>
              </div>
              <FolderTree size={20} />
            </div>
            <div className="toolbar">
              <button onClick={expandAllFolders} disabled={!folderTree.length}>
                Expand all
              </button>
              <button onClick={collapseAllFolders} disabled={!folderTree.length}>
                Collapse all
              </button>
              <button onClick={expandTopLevelFolders} disabled={!folderTree.length}>
                Level 1
              </button>
              <button onClick={selectAllFolders} disabled={!folderTree.length}>
                Select all
              </button>
              <button onClick={deselectAllFolders} disabled={!folderTree.length}>
                Deselect
              </button>
            </div>

            {activeSection === "Scan" ? (
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
            ) : (
              <div className="panel-note">
                <strong>{visibleMediaFiles.length.toLocaleString()} files in view</strong>
                <span>
                  {activeFolderFilterCount}/{allFolderPaths.length || 0} folders selected
                </span>
              </div>
            )}

            <div className="tree">
              {folderTree.length ? (
                folderTree.map((node) => (
                  <div className="tree-root" key={node.path}>
                    <TreeRow
                      node={node}
                      expandedFolderPaths={expandedFolderPaths}
                      selectedFolderPaths={selectedFolderPaths}
                      onToggleExpanded={toggleFolderExpanded}
                      onToggleSelected={toggleFolderSelected}
                    />
                    {activeSection === "Scan" && node.path ? (
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

            {activeSection === "Scan" ? (
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
            ) : null}

            {activeSection === "Scan" ? (
              <>
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
              </>
            ) : (
              <div className="panel-note">
                <strong>Tree navigation is active here too</strong>
                <span>Expand, collapse, and select folders to page through just that slice of the library.</span>
              </div>
            )}
          </section>

          <div className="resize-rail subtle" aria-hidden="true" />
            </>
          ) : null}

          {activeSection === "Scan" || activeSection === "Library" ? (
          <section className={`panel library-panel ${activeSection === "Library" ? "library-full" : ""}`}>
            <div className="panel-header">
              <div>
                <h2>{activePreviewLabel}</h2>
                <p>
                  {activeSection === "Library"
                    ? "Full visible media set with larger previews and the same tagging controls."
                    : `First ${scanPreviewLimit} visible files with full-fit thumbnails for a fast scan review.`}
                </p>
              </div>
              <div className="view-actions">
                <button className="icon-button" aria-label="Grid view" title="Grid view">
                  <Grid3X3 size={18} />
                </button>
                <div className="size-toggle" aria-label="Thumbnail size">
                  {thumbnailSizes.map((size) => (
                    <button
                      className={thumbnailSize === size ? "active" : ""}
                      key={size}
                      onClick={() => setThumbnailSize(size)}
                    >
                      {size}
                    </button>
                  ))}
                </div>
                <button className="icon-button" aria-label="Detailed list" disabled title="View toggle is not built yet.">
                  <ListFilter size={18} />
                </button>
                {activeSection === "Library" ? (
                  <button
                    className="icon-button"
                    aria-label={detailPanelOpen ? "Hide details panel" : "Show details panel"}
                    title={detailPanelOpen ? "Hide details panel" : "Show details panel"}
                    onClick={() => setDetailPanelOpen((open) => !open)}
                  >
                    {detailPanelOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                  </button>
                ) : null}
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

            <div className={activeSection === "Library" ? `library-workbench ${detailPanelOpen ? "" : "details-collapsed"}` : ""}>
              <div className="library-main">
                <div
                  className={`media-grid thumb-size-${thumbnailSize} ${activeSection === "Library" ? "library-grid" : ""}`}
                >
                  {visibleMediaFiles.length ? (
                    activePreviewFiles.map((item) => (
                      <article
                        className={`media-card ${item.missing ? "missing" : ""} ${
                          selectedFileIds.includes(item.id) ? "selected" : ""
                        } ${activeMediaItem?.id === item.id ? "active-item" : ""}`}
                        key={item.path}
                        onClick={() => activateMediaFile(item.id)}
                        title={`${item.filename} | ${item.path}`}
                        style={{
                          width: `${activeThumbnailDimensions.width}px`,
                          height: `${activeThumbnailDimensions.height}px`
                        }}
                      >
                        <div
                          className="thumb"
                          style={{
                            width: `${activeThumbnailDimensions.width}px`,
                            height: `${activeThumbnailDimensions.height}px`,
                            minHeight: `${activeThumbnailDimensions.height}px`
                          }}
                        >
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
                      </article>
                    ))
                  ) : (
                    <div className="empty-state wide">No media files found yet. Add a path and start a scan.</div>
                  )}
                </div>
                {activeSection === "Scan" && visibleMediaFiles.length > previewMediaFiles.length ? (
                  <div className="preview-limit">
                    Showing first {previewMediaFiles.length} previews here. Open Library to browse all {visibleMediaFiles.length.toLocaleString()} visible files.
                  </div>
                ) : null}
                {activeSection === "Library" ? (
                  <div className="pagination-bar">
                    <div className="page-size-control">
                      <span>Items per page</span>
                      <div className="size-toggle" aria-label="Items per page">
                        {libraryPageSizes.map((size) => (
                          <button
                            className={libraryPageSize === size ? "active" : ""}
                            key={size}
                            onClick={() => {
                              setLibraryPageSize(size);
                              setLibraryPage(1);
                            }}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="page-nav">
                      <button onClick={() => setLibraryPage((current) => Math.max(1, current - 1))} disabled={clampedLibraryPage === 1}>
                        <ChevronLeft size={16} />
                        Prev
                      </button>
                      {paginationItems.map((item, index) =>
                        typeof item === "number" ? (
                          <button
                            className={item === clampedLibraryPage ? "active" : ""}
                            key={item}
                            onClick={() => setLibraryPage(item)}
                          >
                            {item}
                          </button>
                        ) : (
                          <span className="page-ellipsis" key={`${item}-${index}`}>
                            ...
                          </span>
                        )
                      )}
                      <button
                        onClick={() => setLibraryPage((current) => Math.min(libraryPageCount, current + 1))}
                        disabled={clampedLibraryPage === libraryPageCount}
                      >
                        Next
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="data-grid" role="table" aria-label="Detailed media results">
              <div className="data-grid-row header" role="row">
                <span>Select</span>
                <span>Name</span>
                <span>Type</span>
                <span>Size</span>
                <span>Date taken</span>
                <span>Path</span>
              </div>
              {gridMediaFiles.map((item) => (
                <div
                  className={`data-grid-row ${selectedFileIds.includes(item.id) ? "selected" : ""}`}
                  role="row"
                  key={`${item.path}-row`}
                  onClick={() => activateMediaFile(item.id)}
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
              </div>
              {activeSection === "Library" && detailPanelOpen ? (
                <aside className="detail-panel">
                  <div className="detail-panel-header">
                    <strong>Details</strong>
                    <button
                      className="icon-button small"
                      aria-label="Collapse details panel"
                      title="Collapse details panel"
                      onClick={() => setDetailPanelOpen(false)}
                    >
                      <ChevronUp size={16} />
                    </button>
                  </div>
                  {activeMediaItem ? (
                    <>
                      <div className="detail-preview">
                        <DetailPreview item={activeMediaItem} />
                      </div>
                      <div className="detail-copy">
                        <strong>{activeMediaItem.filename}</strong>
                        <span>{activeMediaItem.path}</span>
                      </div>
                      <div className="detail-section">
                        <div className="detail-row">
                          <span><FileImage size={14} /> Type</span>
                          <strong>{activeMediaItem.extension.toUpperCase()} / {formatMediaType(activeMediaItem.mediaType)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><CalendarClock size={14} /> Date taken</span>
                          <strong>{formatDate(activeMediaItem.dateTakenUnix)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><HardDrive size={14} /> File size</span>
                          <strong>{activeMediaItem.fileSizeMb} MB</strong>
                        </div>
                        <div className="detail-row">
                          <span><Grid3X3 size={14} /> Dimensions</span>
                          <strong>{formatDimensions(activeMediaItem)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><Clock3 size={14} /> Scanned</span>
                          <strong>{formatDate(activeMediaItem.scannedAtUnix)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><Folder size={14} /> Folder</span>
                          <strong>{fileFolderPath(activeMediaItem.path)}</strong>
                        </div>
                      </div>
                      <div className="detail-section">
                        <span className="detail-label">Actions</span>
                        <div className="detail-actions">
                          <button onClick={openActiveFileLocation}>
                            <FolderOpen size={16} />
                            Open location
                          </button>
                        </div>
                      </div>
                      <div className="detail-section">
                        <span className="detail-label">Tags</span>
                        <div className="detail-tag-list">
                          {activeMediaItem.tags.length ? (
                            activeMediaItem.tags.map((tag) => <span key={tag}>{tag}</span>)
                          ) : (
                            <span className="detail-empty">No tags yet</span>
                          )}
                        </div>
                      </div>
                      <div className="detail-section">
                        <span className="detail-label">Selection</span>
                        <div className="detail-meta-note">
                          {selectedFileIds.length} selected. Tagging and future move/copy actions can still run across the whole selection.
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="detail-empty-state">Select a file to inspect it here.</div>
                  )}
                </aside>
              ) : null}
            </div>
            {activeSection === "Scan" && visibleMediaFiles.length > gridMediaFiles.length ? (
              <div className="preview-limit">
                Showing first {gridMediaFiles.length} rows.
              </div>
            ) : null}
          </section>
          ) : null}
        </div>

        <footer className="status-bar" aria-live="polite">
          <div className="status-primary">
            <span className={`status-dot ${isBusy ? "active" : ""}`} />
            <strong>{status}</strong>
          </div>
          <div className="status-details">
            <span>{(activeSection === "Duplicates" ? duplicateFileCount : visibleMediaFiles.length).toLocaleString()} visible</span>
            <span>{(activeSection === "Duplicates" ? duplicateItems.length : activePreviewFiles.length).toLocaleString()} previews loaded</span>
            <span>{mediaFiles.length.toLocaleString()} cached</span>
            <span>{selectedFileIds.length.toLocaleString()} selected</span>
            {activeSection === "Duplicates" ? (
              <>
                <span>{duplicateGroupCount.toLocaleString()} groups</span>
                <span>{duplicateWasteMb.toFixed(1)} MB reclaimable</span>
              </>
            ) : (
              <>
                <span>
                  {activeFolderFilterCount}/{allFolderPaths.length} folders
                </span>
                <span>{activeFileTypeLabel}</span>
              </>
            )}
            {activeSection === "Library" ? (
              <span>
                page {clampedLibraryPage}/{libraryPageCount}
              </span>
            ) : null}
            {selectedTagFilter ? <span>tag: {selectedTagFilter}</span> : null}
          </div>
        </footer>
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

function formatFileSize(bytes: number) {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  }

  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function buildMoveSegments(item: MediaFile, levels: MoveLevel[]) {
  return levels
    .map((level) => resolveMoveLevelSegment(item, level))
    .filter((segment): segment is string => Boolean(segment && segment.trim()));
}

function resolveMoveLevelSegment(item: MediaFile, level: MoveLevel) {
  switch (level) {
    case "yearTaken":
      return formatMoveYear(resolveMoveDate(item, "taken"), "Unknown Year");
    case "yearCreated":
      return formatMoveYear(resolveMoveDate(item, "created"), "Unknown Year");
    case "yearModified":
      return formatMoveYear(resolveMoveDate(item, "modified"), "Unknown Year");
    case "monthTaken":
      return formatMoveMonth(resolveMoveDate(item, "taken"), "Unknown Month");
    case "monthCreated":
      return formatMoveMonth(resolveMoveDate(item, "created"), "Unknown Month");
    case "monthModified":
      return formatMoveMonth(resolveMoveDate(item, "modified"), "Unknown Month");
    case "fileType":
      return item.extension.toUpperCase();
    case "mediaType":
      return formatMediaType(item.mediaType);
    case "primaryTag":
      return item.tags[0] ?? "Untagged";
    case "sourceFolder":
      return folderLabel(fileFolderPath(item.path));
    default:
      return null;
  }
}

function resolveMoveDate(item: MediaFile, basis: "taken" | "created" | "modified") {
  if (basis === "taken") {
    const candidateDates = [item.dateTakenUnix, item.createdUnix, item.modifiedUnix].filter(
      (value): value is number => value !== null
    );
    if (!candidateDates.length) {
      return null;
    }
    return new Date(Math.min(...candidateDates) * 1000);
  }

  const unix = basis === "created" ? item.createdUnix : item.modifiedUnix;
  return unix ? new Date(unix * 1000) : null;
}

function formatMoveYear(date: Date | null, fallback: string) {
  return date ? `${date.getFullYear()}` : fallback;
}

function formatMoveMonth(date: Date | null, fallback: string) {
  return date
    ? `${String(date.getMonth() + 1).padStart(2, "0")} - ${date.toLocaleString("en-US", { month: "long" })}`
    : fallback;
}

function joinPathParts(base: string, ...parts: string[]) {
  const separator = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/, ""), ...parts]
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : part.replace(/^[\\/]+|[\\/]+$/g, "")))
    .join(separator);
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
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

function DetailPreview({ item }: { item: MediaFile }) {
  const [failed, setFailed] = useState(false);

  if (item.missing) {
    return <FileImage size={56} />;
  }

  if (item.mediaType === "video" && canVideoPreviewExtension(item.extension)) {
    return <video src={convertFileSrc(item.path)} controls muted preload="metadata" onError={() => setFailed(true)} />;
  }

  if (canPreviewExtension(item.extension) && !failed) {
    return <img src={convertFileSrc(item.path)} alt="" onError={() => setFailed(true)} loading="lazy" />;
  }

  return item.mediaType === "video" ? <Film size={56} /> : <FileImage size={56} />;
}

function canPreviewExtension(extension: string) {
  return ["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp"].includes(extension.toLowerCase());
}

function canVideoPreviewExtension(extension: string) {
  return ["mp4", "mov", "m4v", "webm"].includes(extension.toLowerCase());
}

function formatMediaType(mediaType: string) {
  switch (mediaType) {
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "raw":
      return "RAW";
    default:
      return "Media";
  }
}

function buildFolderTree(scanPaths: string[], scanFolders: ScanFolder[], mediaFiles: MediaFile[]) {
  const countByFolder = new Map<string, number>();
  for (const file of mediaFiles) {
    const folderPath = fileFolderPath(file.path);
    countByFolder.set(folderPath, (countByFolder.get(folderPath) ?? 0) + 1);
  }

  return scanPaths.map((rootPath) => {
    const root: FolderNode = {
      label: folderLabel(rootPath),
      path: rootPath,
      count: countFilesUnderFolder(rootPath, countByFolder),
      children: []
    };

    const foldersForRoot = scanFolders
      .filter((folder) => folder.scanRoot === rootPath)
      .map((folder) => folder.path)
      .filter((folderPath) => folderPath !== rootPath);

    for (const folderPath of foldersForRoot) {
      const relative = relativePath(rootPath, folderPath);
      const folderParts = relative.split(/[\\/]/).filter(Boolean);
      let current = root;
      let currentPath = rootPath;

      for (const folderPart of folderParts) {
        currentPath = joinDisplayPath(currentPath, folderPart);
        let child = current.children.find((node) => node.label === folderPart);
        if (!child) {
          child = {
            label: folderPart,
            path: currentPath,
            count: countFilesUnderFolder(currentPath, countByFolder),
            children: []
          };
          current.children.push(child);
        }
        current = child;
      }
    }

    sortFolderTree(root);
    return root;
  });
}

function countFilesUnderFolder(folderPath: string, countByFolder: Map<string, number>) {
  let count = 0;
  for (const [fileFolder, folderCount] of countByFolder) {
    if (fileFolder === folderPath || isPathInside(fileFolder, folderPath)) {
      count += folderCount;
    }
  }
  return count;
}

function sortFolderTree(node: FolderNode) {
  node.children.sort((left, right) => left.label.localeCompare(right.label));
  node.children.forEach(sortFolderTree);
}

function collectNodePaths(nodes: FolderNode[]): string[] {
  return nodes.flatMap((node) => [node.path ?? node.label, ...collectNodePaths(node.children)]);
}

function mergeKnownPaths(currentPaths: string[], knownPaths: string[]) {
  const filtered = currentPaths.filter((path) => knownPaths.includes(path));
  const additions = knownPaths.filter((path) => !filtered.includes(path));
  return [...filtered, ...additions];
}

function isPathInside(filePath: string, folderPath: string) {
  const normalizedFilePath = filePath.toLowerCase();
  const normalizedFolderPath = folderPath.replace(/[\\/]+$/, "").toLowerCase();
  return normalizedFilePath === normalizedFolderPath || normalizedFilePath.startsWith(`${normalizedFolderPath}\\`) || normalizedFilePath.startsWith(`${normalizedFolderPath}/`);
}

function relativePath(rootPath: string, filePath: string) {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "").toLowerCase();
  if (filePath.toLowerCase().startsWith(normalizedRoot)) {
    return filePath.slice(rootPath.replace(/[\\/]+$/, "").length).replace(/^[\\/]/, "");
  }

  return filePath;
}

function fileFolderPath(filePath: string) {
  const parts = filePath.split(/[\\/]/);
  parts.pop();
  return parts.join(filePath.includes("\\") ? "\\" : "/");
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

function buildPaginationItems(currentPage: number, pageCount: number) {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, pageCount, currentPage, currentPage - 1, currentPage + 1]);
  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (currentPage >= pageCount - 2) {
    pages.add(pageCount - 1);
    pages.add(pageCount - 2);
    pages.add(pageCount - 3);
  }

  const sortedPages = Array.from(pages)
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((left, right) => left - right);

  const items: Array<number | "ellipsis"> = [];
  for (const page of sortedPages) {
    const previous = items[items.length - 1];
    if (typeof previous === "number" && page - previous > 1) {
      items.push("ellipsis");
    }
    items.push(page);
  }

  return items;
}

export { App };
