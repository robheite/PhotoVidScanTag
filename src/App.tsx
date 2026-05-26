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
import { useEffect, useMemo, useRef, useState } from "react";

const sections = [
  { label: "Scan", icon: ScanSearch, enabled: true },
  { label: "Library", icon: Grid3X3, enabled: true },
  { label: "Duplicates", icon: Hash, enabled: true },
  { label: "Move/Copy", icon: MoveRight, enabled: true },
  { label: "Settings", icon: Settings, enabled: true }
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
  { value: "dayTaken", label: "Day taken" },
  { value: "monthCreated", label: "Month created" },
  { value: "monthModified", label: "Month modified" },
  { value: "none", label: "None" },
  { value: "fileType", label: "File type" },
  { value: "mediaType", label: "Media type" },
  { value: "primaryTag", label: "Primary tag" },
  { value: "sourceFolder", label: "Source folder" }
] as const;
type AppSection = "Scan" | "Library" | "Duplicates" | "Move/Copy" | "Settings";
type ThumbnailSize = (typeof thumbnailSizes)[number];
type MoveScope = "selected" | "folders" | "all";
type MoveMode = "copy" | "move";
type MoveLevel =
  | "yearTaken"
  | "yearCreated"
  | "yearModified"
  | "monthTaken"
  | "dayTaken"
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

type ScanExecutionReport = {
  mode: "refresh" | "full";
  executedAtUnix: number;
  paths: string[];
  extensions: string[];
  result: ScanResponse;
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

type ExecuteMoveCopyResponse = {
  processedItems: number;
  copiedItems: number;
  movedItems: number;
  renamedItems: number;
  skippedExisting: number;
  skippedSamePath: number;
  failedItems: number;
  itemResults: MoveCopyItemResult[];
  errors: string[];
};

type MoveCopyItemResult = {
  sourcePath: string;
  requestedDestinationPath: string;
  finalDestinationPath: string | null;
  status: string;
  action: string;
  note: string;
};

type MoveExecutionReport = {
  mode: MoveMode;
  collisionPolicy: MoveCollisionPolicy;
  destinationRoot: string;
  executedAtUnix: number;
  summary: ExecuteMoveCopyResponse;
  plannedItems: MovePreviewItem[];
};

type CleanupDuplicatesResponse = {
  processedItems: number;
  movedItems: number;
  deletedItems: number;
  renamedItems: number;
  skippedExisting: number;
  failedItems: number;
  errors: string[];
};

type AppSettings = {
  selectedExtensions: string[];
  defaultThumbnailSize: ThumbnailSize;
  defaultLibraryPageSize: number;
  filterPresets: FilterPreset[];
  historyRetentionCount: number;
  logReportExports: boolean;
  logSuccessfulOperations: boolean;
  appDataDir: string;
  databasePath: string;
  startupLogPath: string;
};

type MoveCollisionPolicy = "skip" | "rename";
type DuplicateCleanupMode = "move" | "delete";
type SplitSection = "Scan" | "Library" | "Duplicates" | "Move/Copy" | "Settings";
type MediaTypeFilter = "all" | "image" | "video";
type MissingFilterMode = "hide" | "include" | "only";
type TagMatchMode = "any" | "all";
type DateSourceFilter = "all" | "metadata" | "filesystem-created" | "filesystem-modified" | "unknown";
type FilterPreset = {
  name: string;
  mediaTypeFilter: MediaTypeFilter;
  extensionFilter: string;
  missingFilterMode: MissingFilterMode;
  tagFilterInput: string;
  tagMatchMode: TagMatchMode;
  dateFromInput: string;
  dateToInput: string;
  minFileSizeMb: string;
  maxFileSizeMb: string;
  minMegapixels: string;
  maxMegapixels: string;
  dateSourceFilter: DateSourceFilter;
  selectedTagFilter: string | null;
};
type GridColumnSet = "media" | "duplicate" | "move";

type OperationHistoryEntry = {
  id: number;
  operationType: string;
  status: string;
  summary: string;
  details: string | null;
  createdAtUnix: number;
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
  const [lastScanExecutionReport, setLastScanExecutionReport] = useState<ScanExecutionReport | null>(null);
  const [status, setStatus] = useState("Ready");
  const [isScanning, setIsScanning] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<MediaTypeFilter>("all");
  const [extensionFilter, setExtensionFilter] = useState("all");
  const [missingFilterMode, setMissingFilterMode] = useState<MissingFilterMode>("hide");
  const [tagFilterInput, setTagFilterInput] = useState("");
  const [tagMatchMode, setTagMatchMode] = useState<TagMatchMode>("any");
  const [dateFromInput, setDateFromInput] = useState("");
  const [dateToInput, setDateToInput] = useState("");
  const [minFileSizeMb, setMinFileSizeMb] = useState("");
  const [maxFileSizeMb, setMaxFileSizeMb] = useState("");
  const [minMegapixels, setMinMegapixels] = useState("");
  const [maxMegapixels, setMaxMegapixels] = useState("");
  const [dateSourceFilter, setDateSourceFilter] = useState<DateSourceFilter>("all");
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>([]);
  const [selectedFilterPresetName, setSelectedFilterPresetName] = useState("");
  const [filterPresetDraftName, setFilterPresetDraftName] = useState("");
  const [historyRetentionCount, setHistoryRetentionCount] = useState(200);
  const [logReportExports, setLogReportExports] = useState(true);
  const [logSuccessfulOperations, setLogSuccessfulOperations] = useState(true);
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
  const [detailPanelWidth, setDetailPanelWidth] = useState(320);
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
  const [moveLevelFour, setMoveLevelFour] = useState<MoveLevel>("primaryTag");
  const [movePreviewItems, setMovePreviewItems] = useState<MovePreviewItem[]>([]);
  const [moveExpandedFolderPaths, setMoveExpandedFolderPaths] = useState<string[]>([]);
  const [moveSelectedFolderPaths, setMoveSelectedFolderPaths] = useState<string[]>([]);
  const [moveScanPreviewOpen, setMoveScanPreviewOpen] = useState(false);
  const [isExecutingMoveCopy, setIsExecutingMoveCopy] = useState(false);
  const [moveCollisionPolicy, setMoveCollisionPolicy] = useState<MoveCollisionPolicy>("skip");
  const [lastMoveExecutionReport, setLastMoveExecutionReport] = useState<MoveExecutionReport | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [operationHistory, setOperationHistory] = useState<OperationHistoryEntry[]>([]);
  const [duplicateCleanupMode, setDuplicateCleanupMode] = useState<DuplicateCleanupMode>("move");
  const [duplicateCleanupDestination, setDuplicateCleanupDestination] = useState("");
  const [duplicateCleanupCollisionPolicy, setDuplicateCleanupCollisionPolicy] = useState<MoveCollisionPolicy>("skip");
  const [duplicateCleanupConfirmed, setDuplicateCleanupConfirmed] = useState(false);
  const [isCleaningDuplicates, setIsCleaningDuplicates] = useState(false);
  const detailResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [panelSplitWidths, setPanelSplitWidths] = useState<Record<SplitSection, number>>({
    Scan: 520,
    Library: 520,
    Duplicates: 420,
    "Move/Copy": 460,
    Settings: 520
  });
  const splitResizeRef = useRef<{ section: SplitSection; startX: number; startWidth: number } | null>(null);
  const [gridColumnWidths, setGridColumnWidths] = useState<Record<GridColumnSet, number[]>>({
    media: [52, 240, 90, 96, 128, 420],
    duplicate: [52, 220, 90, 96, 128, 360, 220],
    move: [220, 240, 360, 420]
  });
  const gridResizeRef = useRef<{ set: GridColumnSet; index: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    void initializeAppData();
  }, []);

  const extensionGroups = useMemo(() => groupExtensions(availableExtensions), [availableExtensions]);
  const extensionFilterOptions = useMemo(
    () => [...new Set(mediaFiles.map((file) => file.extension.toLowerCase()))].sort(),
    [mediaFiles]
  );
  const parsedTagFilters = useMemo(
    () =>
      tagFilterInput
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    [tagFilterInput]
  );
  const parsedMinFileSizeMb = useMemo(() => parseFilterNumber(minFileSizeMb), [minFileSizeMb]);
  const parsedMaxFileSizeMb = useMemo(() => parseFilterNumber(maxFileSizeMb), [maxFileSizeMb]);
  const parsedMinMegapixels = useMemo(() => parseFilterNumber(minMegapixels), [minMegapixels]);
  const parsedMaxMegapixels = useMemo(() => parseFilterNumber(maxMegapixels), [maxMegapixels]);

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

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (gridResizeRef.current) {
        const delta = event.clientX - gridResizeRef.current.startX;
        const nextWidth = Math.max(60, gridResizeRef.current.startWidth + delta);
        setGridColumnWidths((current) => ({
          ...current,
          [gridResizeRef.current!.set]: current[gridResizeRef.current!.set].map((width, index) =>
            index === gridResizeRef.current!.index ? nextWidth : width
          )
        }));
        return;
      }

      if (!detailResizeRef.current) {
        if (splitResizeRef.current) {
          const delta = event.clientX - splitResizeRef.current.startX;
          const nextWidth = Math.min(860, Math.max(300, splitResizeRef.current.startWidth + delta));
          setPanelSplitWidths((current) => ({
            ...current,
            [splitResizeRef.current!.section]: nextWidth
          }));
        }
        return;
      }

      const delta = detailResizeRef.current.startX - event.clientX;
      const nextWidth = Math.min(560, Math.max(260, detailResizeRef.current.startWidth + delta));
      setDetailPanelWidth(nextWidth);
    };

    const handleMouseUp = () => {
      gridResizeRef.current = null;
      detailResizeRef.current = null;
      splitResizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const visibleMediaFiles = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    const folderFilteredFiles = allFolderPaths.length
      ? mediaFiles.filter((file) => selectedFolderSet.has(fileFolderPath(file.path)))
      : mediaFiles;
    const tagFilteredFiles = selectedTagFilter
      ? folderFilteredFiles.filter((file) => file.tags.includes(selectedTagFilter))
      : folderFilteredFiles;
    const multiTagFilteredFiles = parsedTagFilters.length
      ? tagFilteredFiles.filter((file) => {
          const normalizedTags = file.tags.map((tag) => tag.toLowerCase());
          return tagMatchMode === "all"
            ? parsedTagFilters.every((tag) => normalizedTags.includes(tag))
            : parsedTagFilters.some((tag) => normalizedTags.includes(tag));
        })
      : tagFilteredFiles;
    const missingFilteredFiles = multiTagFilteredFiles.filter((file) => {
      if (missingFilterMode === "only") {
        return file.missing;
      }

      if (missingFilterMode === "include") {
        return true;
      }

      return !file.missing;
    });
    const datedFilteredFiles = missingFilteredFiles.filter((file) => {
      if (!dateFromInput && !dateToInput) {
        return true;
      }

      const filterDate = resolveMoveDate(file, "taken");
      if (!filterDate) {
        return false;
      }

      const filterTime = filterDate.getTime();
      if (dateFromInput) {
        const fromTime = new Date(`${dateFromInput}T00:00:00`).getTime();
        if (filterTime < fromTime) {
          return false;
        }
      }

      if (dateToInput) {
        const toTime = new Date(`${dateToInput}T23:59:59`).getTime();
        if (filterTime > toTime) {
          return false;
        }
      }

      return true;
    });
    const metadataFilteredFiles = datedFilteredFiles.filter((file) => {
      if (dateSourceFilter !== "all") {
        const normalizedSource = normalizeDateSourceFilter(file.dateSource);
        if (normalizedSource !== dateSourceFilter) {
          return false;
        }
      }

      if (parsedMinFileSizeMb !== null && file.fileSizeMb < parsedMinFileSizeMb) {
        return false;
      }

      if (parsedMaxFileSizeMb !== null && file.fileSizeMb > parsedMaxFileSizeMb) {
        return false;
      }

      if (parsedMinMegapixels !== null) {
        if (file.megapixels === null || file.megapixels < parsedMinMegapixels) {
          return false;
        }
      }

      if (parsedMaxMegapixels !== null) {
        if (file.megapixels === null || file.megapixels > parsedMaxMegapixels) {
          return false;
        }
      }

      return true;
    });
    const mediaTypeFilteredFiles =
      mediaTypeFilter === "all"
        ? metadataFilteredFiles
        : metadataFilteredFiles.filter((file) => file.mediaType === mediaTypeFilter);
    const extensionFilteredFiles =
      extensionFilter === "all"
        ? mediaTypeFilteredFiles
        : mediaTypeFilteredFiles.filter((file) => file.extension.toLowerCase() === extensionFilter);

    if (!query) {
      return extensionFilteredFiles;
    }

    return extensionFilteredFiles.filter((file) =>
      [file.filename, file.extension, file.mediaType, file.path, file.scanRoot]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [
    allFolderPaths.length,
    dateFromInput,
    dateToInput,
    dateSourceFilter,
    extensionFilter,
    mediaFiles,
    mediaTypeFilter,
    missingFilterMode,
    parsedMaxFileSizeMb,
    parsedMaxMegapixels,
    parsedMinFileSizeMb,
    parsedMinMegapixels,
    parsedTagFilters,
    searchText,
    selectedFolderSet,
    selectedTagFilter,
    tagMatchMode
  ]);

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
  const activeSplitWidth = panelSplitWidths[activeSection as SplitSection];
  const activeMediaCollection = activeSection === "Duplicates" ? duplicateItems : visibleMediaFiles;
  const duplicateItemIds = useMemo(() => duplicateItems.map((item) => item.id), [duplicateItems]);
  const selectedDuplicateItems = useMemo(
    () => duplicateItems.filter((item) => selectedFileIds.includes(item.id)),
    [duplicateItems, selectedFileIds]
  );
  const selectedDuplicateCount = useMemo(
    () => selectedDuplicateItems.length,
    [selectedDuplicateItems]
  );
  const selectedDuplicateBytes = useMemo(
    () => selectedDuplicateItems.reduce((total, item) => total + item.fileSizeBytes, 0),
    [selectedDuplicateItems]
  );
  const selectedFolderFileIds = useMemo(() => {
    if (!allFolderPaths.length) {
      return [];
    }

    return mediaFiles
      .filter((file) => !file.missing && selectedFolderSet.has(fileFolderPath(file.path)))
      .map((file) => file.id);
  }, [allFolderPaths.length, mediaFiles, selectedFolderSet]);
  const activeMediaItem = useMemo(
    () =>
      activeMediaCollection.find((item) => item.id === activeMediaId) ??
      activeMediaCollection.find((item) => selectedFileIds.includes(item.id)) ??
      activeMediaCollection[0] ??
      null,
    [activeMediaCollection, activeMediaId, selectedFileIds]
  );
  const activeDuplicateIsSelected = useMemo(
    () => Boolean(activeMediaItem && duplicateItemIds.includes(activeMediaItem.id) && selectedFileIds.includes(activeMediaItem.id)),
    [activeMediaItem, duplicateItemIds, selectedFileIds]
  );

  const configuredRootCount = Math.max(scanPaths.length, scanRoots.length);
  const duplicateGroupCount = duplicateGroups.length;
  const duplicateFileCount = duplicateScanResult?.duplicateFiles ?? duplicateGroups.reduce((sum, group) => sum + group.fileCount, 0);
  const duplicateWasteMb =
    duplicateScanResult?.wastedSizeMb ?? duplicateGroups.reduce((sum, group) => sum + group.wastedSizeMb, 0);
  const isBusy = isScanning || isFindingDuplicates || isExecutingMoveCopy;
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
      const [defaultExtensions, settings, files, roots, folders, savedTags, history] = await Promise.all([
        invoke<string[]>("supported_extensions"),
        invoke<AppSettings>("get_app_settings"),
        invoke<MediaFile[]>("list_media"),
        invoke<ScanRoot[]>("list_scan_roots"),
        invoke<ScanFolder[]>("list_scan_folders"),
        invoke<TagSummary[]>("list_tags"),
        invoke<OperationHistoryEntry[]>("list_operation_history")
      ]);
      setAvailableExtensions(defaultExtensions);
      setAppSettings(settings);
      setSelectedExtensions(settings.selectedExtensions.length ? settings.selectedExtensions : defaultExtensions);
      setThumbnailSize(settings.defaultThumbnailSize);
      setLibraryPageSize(settings.defaultLibraryPageSize);
      setFilterPresets(settings.filterPresets ?? []);
      setHistoryRetentionCount(settings.historyRetentionCount);
      setLogReportExports(settings.logReportExports);
      setLogSuccessfulOperations(settings.logSuccessfulOperations);
      setMediaFiles(files);
      setScanRoots(roots);
      setScanFolders(folders);
      setTags(savedTags);
      setOperationHistory(history);
      setScanPaths((current) => (current.length ? current : roots.map((root) => root.path)));
      const initialTree = buildFolderTree(roots.map((root) => root.path), folders, files);
      setSelectedFolderPaths(collectNodePaths(initialTree));
      setExpandedFolderPaths(roots.map((root) => root.path));
      setStatus(files.length ? `Loaded ${files.length.toLocaleString()} cached files` : "Ready to scan");
    } catch (error) {
      setStatus(`Desktop backend unavailable: ${String(error)}`);
    }
  }

  async function refreshOperationHistory() {
    try {
      const history = await invoke<OperationHistoryEntry[]>("list_operation_history");
      setOperationHistory(history);
    } catch (error) {
      setStatus(`Activity refresh failed: ${String(error)}`);
    }
  }

  function beginDetailResize(clientX: number) {
    if (!detailPanelOpen) {
      return;
    }

    detailResizeRef.current = {
      startX: clientX,
      startWidth: detailPanelWidth
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function beginSplitResize(section: SplitSection, clientX: number) {
    splitResizeRef.current = {
      section,
      startX: clientX,
      startWidth: panelSplitWidths[section]
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function beginGridColumnResize(set: GridColumnSet, index: number, clientX: number) {
    gridResizeRef.current = {
      set,
      index,
      startX: clientX,
      startWidth: gridColumnWidths[set][index]
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
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
      const history = await invoke<OperationHistoryEntry[]>("list_operation_history");
      setScanResult(result);
      setLastScanExecutionReport({
        mode: forceRescan ? "full" : "refresh",
        executedAtUnix: Math.floor(Date.now() / 1000),
        paths: [...scanPaths],
        extensions: [...selectedExtensions],
        result
      });
      setMediaFiles(files);
      setScanRoots(roots);
      setScanFolders(folders);
      setTags(savedTags);
      setOperationHistory(history);
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

  async function exportScanSummaryReport() {
    if (!lastScanExecutionReport) {
      setStatus("Run a scan or refresh first to export its summary");
      return;
    }

    const filePath = await save({
      title: "Export scan summary report",
      defaultPath: `scan-summary-${new Date(lastScanExecutionReport.executedAtUnix * 1000).toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });

    if (!filePath) {
      return;
    }

    const summaryLines = [
      ["Executed at", formatDateTime(lastScanExecutionReport.executedAtUnix)],
      ["Scan mode", lastScanExecutionReport.mode === "full" ? "Full scan" : "Refresh scan"],
      ["Selected paths", `${lastScanExecutionReport.paths.length}`],
      ["Selected file types", `${lastScanExecutionReport.extensions.length}`],
      ["Processed files", `${lastScanExecutionReport.result.scannedFiles}`],
      ["Cached files", `${lastScanExecutionReport.result.cachedFiles}`],
      ["Unchanged files", `${lastScanExecutionReport.result.skippedUnchanged}`],
      ["Missing files", `${lastScanExecutionReport.result.missingFiles}`],
      ["Warnings / errors", `${lastScanExecutionReport.result.errors.length}`]
    ];
    const previewRows = previewMediaFiles.map((item, index) => [
      index + 1,
      item.filename,
      item.fileSizeMb,
      formatMediaType(item.mediaType),
      item.extension.toUpperCase(),
      formatDate(item.dateTakenUnix),
      item.dateSource ?? "Unknown",
      formatDimensions(item),
      item.scanRoot,
      item.missing ? "Yes" : "No",
      item.path
    ]);

    const csvLines = [
      ...summaryLines.map((line) => line.map((value) => csvEscape(value)).join(",")),
      "",
      ["Scan paths"].map(csvEscape).join(","),
      ...lastScanExecutionReport.paths.map((path) => csvEscape(path)),
      "",
      ["Enabled extensions"].map(csvEscape).join(","),
      lastScanExecutionReport.extensions.map((extension) => csvEscape(`.${extension}`)).join(","),
      "",
      ["Scan preview files"].map(csvEscape).join(","),
      ["Row", "Filename", "Size MB", "Type", "Extension", "Date Taken", "Date Source", "Dimensions", "Scan Root", "Missing", "Path"]
        .map(csvEscape)
        .join(","),
      ...previewRows.map((row) => row.map((value) => csvEscape(String(value))).join(",")),
      ""
    ];

    if (lastScanExecutionReport.result.errors.length) {
      csvLines.push(["Warnings / errors"].map(csvEscape).join(","));
      csvLines.push(["Row", "Message"].map(csvEscape).join(","));
      lastScanExecutionReport.result.errors.forEach((error, index) => {
        csvLines.push([index + 1, error].map((value) => csvEscape(String(value))).join(","));
      });
    }

    try {
      await invoke("save_text_report", { path: filePath, contents: csvLines.join("\n") });
      await refreshOperationHistory();
      setStatus(`Exported scan summary report with ${lastScanExecutionReport.result.errors.length.toLocaleString()} warning row(s)`);
    } catch (error) {
      setStatus(`Scan summary export failed: ${String(error)}`);
    }
  }

  async function exportLibraryReport() {
    if (!visibleMediaFiles.length) {
      setStatus("No library files are available to export");
      return;
    }

    const filePath = await save({
      title: "Export library report",
      defaultPath: `library-report-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });

    if (!filePath) {
      return;
    }

    const movePreviewById = new Map(movePreviewItems.map((item) => [item.id, item.destinationPath]));
    const rows = visibleMediaFiles.map((item, index) => [
      index + 1,
      item.filename,
      item.fileSizeMb,
      formatMediaType(item.mediaType),
      item.extension.toUpperCase(),
      formatDate(item.dateTakenUnix),
      formatDate(item.createdUnix),
      formatDate(item.modifiedUnix),
      item.dateSource ?? "Unknown",
      formatDimensions(item),
      item.tags.join(", "),
      item.scanRoot,
      item.missing ? "Yes" : "No",
      item.path,
      movePreviewById.get(item.id) ?? ""
    ]);

    const summaryLines = [
      ["Exported at", formatDateTime(Math.floor(Date.now() / 1000))],
      ["Visible files", `${visibleMediaFiles.length}`],
      ["Selected folders", `${activeFolderFilterCount}/${allFolderPaths.length || 0}`],
      ["Tag filter", selectedTagFilter ?? "None"],
      ["Search text", searchText || "None"],
      ["Planned destination rows", `${movePreviewItems.length}`]
    ];

    const csvLines = [
      ...summaryLines.map((line) => line.map((value) => csvEscape(value)).join(",")),
      "",
      [
        "Row",
        "Filename",
        "Size MB",
        "Type",
        "Extension",
        "Date Taken",
        "Created",
        "Modified",
        "Date Source",
        "Dimensions",
        "Tags",
        "Scan Root",
        "Missing",
        "Current Path",
        "Planned Destination"
      ]
        .map(csvEscape)
        .join(","),
      ...rows.map((row) => row.map((value) => csvEscape(String(value))).join(","))
    ];

    try {
      await invoke("save_text_report", { path: filePath, contents: csvLines.join("\n") });
      await refreshOperationHistory();
      setStatus(`Exported library report with ${rows.length.toLocaleString()} row(s)`);
    } catch (error) {
      setStatus(`Library report export failed: ${String(error)}`);
    }
  }

  async function exportTagReport() {
    const taggedFiles = mediaFiles.filter((item) => item.tags.length && !item.missing);
    if (!taggedFiles.length) {
      setStatus("No tagged files are available to export");
      return;
    }

    const filePath = await save({
      title: "Export tag report",
      defaultPath: `tag-report-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });

    if (!filePath) {
      return;
    }

    const movePreviewById = new Map(movePreviewItems.map((item) => [item.id, item.destinationPath]));
    const summaryLines = [
      ["Exported at", formatDateTime(Math.floor(Date.now() / 1000))],
      ["Unique tags", `${tags.length}`],
      ["Tagged files", `${taggedFiles.length}`],
      ["Active tag filter", selectedTagFilter ?? "None"]
    ];

    const tagSummaryRows = tags.map((tag, index) => [index + 1, tag.name, tag.fileCount]);
    const fileRows = taggedFiles.map((item, index) => [
      index + 1,
      item.filename,
      item.fileSizeMb,
      formatMediaType(item.mediaType),
      item.extension.toUpperCase(),
      formatDate(item.dateTakenUnix),
      formatDate(item.createdUnix),
      formatDate(item.modifiedUnix),
      item.dateSource ?? "Unknown",
      formatDimensions(item),
      item.tags.join(", "),
      item.scanRoot,
      item.path,
      movePreviewById.get(item.id) ?? ""
    ]);

    const csvLines = [
      ...summaryLines.map((line) => line.map((value) => csvEscape(value)).join(",")),
      "",
      ["Tag summary"].map(csvEscape).join(","),
      ["Row", "Tag", "Tagged Files"].map(csvEscape).join(","),
      ...tagSummaryRows.map((row) => row.map((value) => csvEscape(String(value))).join(",")),
      "",
      ["Tagged files"].map(csvEscape).join(","),
      [
        "Row",
        "Filename",
        "Size MB",
        "Type",
        "Extension",
        "Date Taken",
        "Created",
        "Modified",
        "Date Source",
        "Dimensions",
        "Tags",
        "Scan Root",
        "Current Path",
        "Planned Destination"
      ]
        .map(csvEscape)
        .join(","),
      ...fileRows.map((row) => row.map((value) => csvEscape(String(value))).join(","))
    ];

    try {
      await invoke("save_text_report", { path: filePath, contents: csvLines.join("\n") });
      await refreshOperationHistory();
      setStatus(`Exported tag report with ${fileRows.length.toLocaleString()} tagged file row(s)`);
    } catch (error) {
      setStatus(`Tag report export failed: ${String(error)}`);
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

  async function openSettingsLogLocation() {
    if (!appSettings?.startupLogPath) {
      setStatus("Log file path is not available yet");
      return;
    }

    try {
      await invoke("open_file_location", { path: appSettings.startupLogPath });
      setStatus("Opened startup log location");
    } catch (error) {
      setStatus(`Open log location failed: ${String(error)}`);
    }
  }

  async function saveSettings() {
    if (!selectedExtensions.length) {
      setStatus("Enable at least one file type before saving settings");
      return;
    }

    try {
      const savedSettings = await invoke<AppSettings>("save_app_settings", {
        request: {
          selectedExtensions,
          defaultThumbnailSize: thumbnailSize,
          defaultLibraryPageSize: libraryPageSize,
          filterPresets,
          historyRetentionCount,
          logReportExports,
          logSuccessfulOperations
        }
      });
      setAppSettings(savedSettings);
      setSelectedExtensions(savedSettings.selectedExtensions);
      setThumbnailSize(savedSettings.defaultThumbnailSize);
      setLibraryPageSize(savedSettings.defaultLibraryPageSize);
      setFilterPresets(savedSettings.filterPresets ?? []);
      setHistoryRetentionCount(savedSettings.historyRetentionCount);
      setLogReportExports(savedSettings.logReportExports);
      setLogSuccessfulOperations(savedSettings.logSuccessfulOperations);
      await refreshOperationHistory();
      setStatus("Settings saved");
    } catch (error) {
      setStatus(`Save settings failed: ${String(error)}`);
    }
  }

  function buildCurrentFilterPreset(name: string): FilterPreset {
    return {
      name: name.trim(),
      mediaTypeFilter,
      extensionFilter,
      missingFilterMode,
      tagFilterInput,
      tagMatchMode,
      dateFromInput,
      dateToInput,
      minFileSizeMb,
      maxFileSizeMb,
      minMegapixels,
      maxMegapixels,
      dateSourceFilter,
      selectedTagFilter
    };
  }

  function applyFilterPreset(name: string) {
    const preset = filterPresets.find((item) => item.name === name);
    if (!preset) {
      setStatus("Choose a saved filter preset first");
      return;
    }

    setMediaTypeFilter(preset.mediaTypeFilter);
    setExtensionFilter(preset.extensionFilter);
    setMissingFilterMode(preset.missingFilterMode);
    setTagFilterInput(preset.tagFilterInput);
    setTagMatchMode(preset.tagMatchMode);
    setDateFromInput(preset.dateFromInput);
    setDateToInput(preset.dateToInput);
    setMinFileSizeMb(preset.minFileSizeMb);
    setMaxFileSizeMb(preset.maxFileSizeMb);
    setMinMegapixels(preset.minMegapixels);
    setMaxMegapixels(preset.maxMegapixels);
    setDateSourceFilter(preset.dateSourceFilter);
    setSelectedTagFilter(preset.selectedTagFilter);
    setSelectedFilterPresetName(preset.name);
    setFilterPresetDraftName(preset.name);
    setStatus(`Applied filter preset: ${preset.name}`);
  }

  async function saveFilterPreset() {
    const nextName = filterPresetDraftName.trim() || selectedFilterPresetName.trim();
    if (!nextName) {
      setStatus("Enter a preset name first");
      return;
    }

    const nextPreset = buildCurrentFilterPreset(nextName);
    const nextPresets = [...filterPresets.filter((item) => item.name !== nextName), nextPreset].sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    try {
      const savedSettings = await invoke<AppSettings>("save_app_settings", {
        request: {
          selectedExtensions,
          defaultThumbnailSize: thumbnailSize,
          defaultLibraryPageSize: libraryPageSize,
          filterPresets: nextPresets,
          historyRetentionCount,
          logReportExports,
          logSuccessfulOperations
        }
      });
      setAppSettings(savedSettings);
      setFilterPresets(savedSettings.filterPresets ?? []);
      setSelectedFilterPresetName(nextName);
      setFilterPresetDraftName(nextName);
      await refreshOperationHistory();
      setStatus(`Saved filter preset: ${nextName}`);
    } catch (error) {
      setStatus(`Save preset failed: ${String(error)}`);
    }
  }

  async function deleteFilterPreset() {
    if (!selectedFilterPresetName) {
      setStatus("Choose a filter preset to delete first");
      return;
    }

    const nextPresets = filterPresets.filter((item) => item.name !== selectedFilterPresetName);
    try {
      const savedSettings = await invoke<AppSettings>("save_app_settings", {
        request: {
          selectedExtensions,
          defaultThumbnailSize: thumbnailSize,
          defaultLibraryPageSize: libraryPageSize,
          filterPresets: nextPresets,
          historyRetentionCount,
          logReportExports,
          logSuccessfulOperations
        }
      });
      setAppSettings(savedSettings);
      setFilterPresets(savedSettings.filterPresets ?? []);
      const deletedName = selectedFilterPresetName;
      setSelectedFilterPresetName("");
      setFilterPresetDraftName("");
      await refreshOperationHistory();
      setStatus(`Deleted filter preset: ${deletedName}`);
    } catch (error) {
      setStatus(`Delete preset failed: ${String(error)}`);
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
        created: formatDate(item.createdUnix),
        modified: formatDate(item.modifiedUnix),
        dateSource: item.dateSource ?? "Unknown",
        dimensions: formatDimensions(item),
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
      "Created",
      "Modified",
      "Date Source",
      "Dimensions",
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
          row.created,
          row.modified,
          row.dateSource,
          row.dimensions,
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
      await refreshOperationHistory();
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

  async function chooseDuplicateCleanupDestination() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose duplicate cleanup folder"
    });

    if (typeof selected === "string" && selected.trim()) {
      setDuplicateCleanupDestination(selected);
      setStatus(`Cleanup folder selected: ${selected}`);
    }
  }

  async function exportMoveExecutionReport() {
    if (!lastMoveExecutionReport) {
      setStatus("Run a move or copy first to export its execution report");
      return;
    }

    const filePath = await save({
      title: "Export move/copy execution report",
      defaultPath: `move-copy-report-${new Date(lastMoveExecutionReport.executedAtUnix * 1000).toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });

    if (!filePath) {
      return;
    }

    const rows = lastMoveExecutionReport.summary.itemResults.map((item, index) => [
      index + 1,
      lastMoveExecutionReport.mode,
      lastMoveExecutionReport.collisionPolicy,
      item.status,
      item.action,
      item.sourcePath,
      item.requestedDestinationPath,
      item.finalDestinationPath ?? "",
      item.note
    ]);

    const summaryLines = [
      ["Executed at", formatDateTime(lastMoveExecutionReport.executedAtUnix)],
      ["Mode", lastMoveExecutionReport.mode],
      ["Collision policy", lastMoveExecutionReport.collisionPolicy],
      ["Destination root", lastMoveExecutionReport.destinationRoot],
      ["Processed items", `${lastMoveExecutionReport.summary.processedItems}`],
      ["Copied items", `${lastMoveExecutionReport.summary.copiedItems}`],
      ["Moved items", `${lastMoveExecutionReport.summary.movedItems}`],
      ["Renamed items", `${lastMoveExecutionReport.summary.renamedItems}`],
      ["Skipped existing", `${lastMoveExecutionReport.summary.skippedExisting}`],
      ["Skipped same-path", `${lastMoveExecutionReport.summary.skippedSamePath}`],
      ["Failed items", `${lastMoveExecutionReport.summary.failedItems}`]
    ];

    const csvLines = [
      ...summaryLines.map((line) => line.map((value) => csvEscape(value)).join(",")),
      "",
      ["Row", "Mode", "Collision Policy", "Status", "Action", "Source", "Requested Destination", "Final Destination", "Note"]
        .map(csvEscape)
        .join(","),
      ...rows.map((row) => row.map((value) => csvEscape(String(value))).join(","))
    ];

    try {
      await invoke("save_text_report", { path: filePath, contents: csvLines.join("\n") });
      await refreshOperationHistory();
      setStatus(`Exported move/copy execution report with ${rows.length.toLocaleString()} row(s)`);
    } catch (error) {
      setStatus(`Move/copy report export failed: ${String(error)}`);
    }
  }

  async function exportActivityHistoryReport() {
    if (!operationHistory.length) {
      setStatus("No activity history is available to export");
      return;
    }

    const filePath = await save({
      title: "Export activity history report",
      defaultPath: `activity-history-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: "CSV", extensions: ["csv"] }]
    });

    if (!filePath) {
      return;
    }

    const csvLines = [
      ["Exported at", formatDateTime(Math.floor(Date.now() / 1000))].map(csvEscape).join(","),
      ["Entries", `${operationHistory.length}`].map(csvEscape).join(","),
      ["History retention", `${historyRetentionCount}`].map(csvEscape).join(","),
      "",
      ["Row", "When", "Operation", "Status", "Summary", "Details"].map(csvEscape).join(","),
      ...operationHistory.map((entry, index) =>
        [
          index + 1,
          formatDateTime(entry.createdAtUnix),
          formatOperationType(entry.operationType),
          entry.status,
          entry.summary,
          entry.details ?? ""
        ]
          .map((value) => csvEscape(String(value)))
          .join(",")
      )
    ];

    try {
      await invoke("save_text_report", { path: filePath, contents: csvLines.join("\n") });
      await refreshOperationHistory();
      setStatus(`Exported activity history with ${operationHistory.length.toLocaleString()} row(s)`);
    } catch (error) {
      setStatus(`Activity history export failed: ${String(error)}`);
    }
  }

  async function clearActivityHistory() {
    try {
      await invoke("clear_operation_history");
      setOperationHistory([]);
      setStatus("Cleared activity history");
    } catch (error) {
      setStatus(`Clear history failed: ${String(error)}`);
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

  async function executeMoveCopyPlan() {
    if (!movePreviewItems.length) {
      setStatus("Build a preview before running copy or move");
      return;
    }

    const plannedItems = movePreviewItems.map((item) => ({ ...item }));
    setIsExecutingMoveCopy(true);
    setStatus(`${moveMode === "copy" ? "Copying" : "Moving"} ${movePreviewItems.length.toLocaleString()} file(s)...`);
    try {
      const result = await invoke<ExecuteMoveCopyResponse>("execute_move_copy", {
        request: {
          mode: moveMode,
          collisionPolicy: moveCollisionPolicy,
          items: movePreviewItems.map((item) => ({
            sourcePath: item.sourcePath,
            destinationPath: item.destinationPath
          }))
        }
      });

      const completedCount = moveMode === "copy" ? result.copiedItems : result.movedItems;
      setLastMoveExecutionReport({
        mode: moveMode,
        collisionPolicy: moveCollisionPolicy,
        destinationRoot: moveDestination,
        executedAtUnix: Math.floor(Date.now() / 1000),
        summary: result,
        plannedItems
      });
      setMovePreviewItems([]);
      await initializeAppData();
      if (result.errors.length) {
        setStatus(
          `${moveMode === "copy" ? "Copy" : "Move"} finished: ${completedCount.toLocaleString()} completed, ${result.renamedItems.toLocaleString()} renamed, ${result.skippedExisting.toLocaleString()} skipped existing, ${result.failedItems.toLocaleString()} failed`
        );
      } else {
        setStatus(
          `${moveMode === "copy" ? "Copy" : "Move"} finished: ${completedCount.toLocaleString()} completed, ${result.renamedItems.toLocaleString()} renamed, ${result.skippedExisting.toLocaleString()} skipped existing, ${result.skippedSamePath.toLocaleString()} skipped same-path`
        );
      }
    } catch (error) {
      setStatus(`Move/copy execution failed: ${String(error)}`);
    } finally {
      setIsExecutingMoveCopy(false);
    }
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
      await refreshOperationHistory();
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

  function selectFilesInSelectedFolders() {
    if (!selectedFolderFileIds.length) {
      setStatus("Select one or more library folders first");
      return;
    }

    setSelectedFileIds((currentIds) => [...new Set([...currentIds, ...selectedFolderFileIds])]);
    setStatus(`Selected ${selectedFolderFileIds.length.toLocaleString()} file(s) from the current library folders`);
  }

  function clearFilesInSelectedFolders() {
    if (!selectedFolderFileIds.length) {
      setStatus("Select one or more library folders first");
      return;
    }

    setSelectedFileIds((currentIds) => currentIds.filter((id) => !selectedFolderFileIds.includes(id)));
    setStatus("Cleared file selection for the current library folders");
  }

  function selectVisibleFiles() {
    const selectableVisibleIds = visibleMediaFiles.filter((item) => !item.missing).map((item) => item.id);
    if (!selectableVisibleIds.length) {
      setStatus("No visible non-missing files to select");
      return;
    }

    setSelectedFileIds((currentIds) => [...new Set([...currentIds, ...selectableVisibleIds])]);
    setStatus(`Selected ${selectableVisibleIds.length.toLocaleString()} visible file(s)`);
  }

  function clearVisibleFiles() {
    const visibleIds = new Set(visibleMediaFiles.map((item) => item.id));
    if (!visibleIds.size) {
      setStatus("No visible files to clear");
      return;
    }

    setSelectedFileIds((currentIds) => currentIds.filter((id) => !visibleIds.has(id)));
    setStatus("Cleared visible file selection");
  }

  function resetAdvancedFilters() {
    setMediaTypeFilter("all");
    setExtensionFilter("all");
    setMissingFilterMode("hide");
    setTagFilterInput("");
    setTagMatchMode("any");
    setDateFromInput("");
    setDateToInput("");
    setMinFileSizeMb("");
    setMaxFileSizeMb("");
    setMinMegapixels("");
    setMaxMegapixels("");
    setDateSourceFilter("all");
    setStatus("Reset advanced filters");
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

  function keepActiveAndPrepareCleanup() {
    if (!duplicateItems.length || !activeMediaItem || !duplicateItemIds.includes(activeMediaItem.id)) {
      setStatus("Select a duplicate item to keep first");
      return;
    }

    const otherIds = duplicateItemIds.filter((id) => id !== activeMediaItem.id);
    setSelectedFileIds(otherIds);
    setDuplicateCleanupConfirmed(false);
    setStatus(
      `Prepared cleanup for ${otherIds.length.toLocaleString()} duplicate file(s) while keeping ${activeMediaItem.filename}`
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

  async function runDuplicateCleanup() {
    const selectedPaths = duplicateItems.filter((item) => selectedFileIds.includes(item.id)).map((item) => item.path);
    if (!selectedPaths.length) {
      setStatus("Select one or more duplicate files first");
      return;
    }

    if (duplicateItems.length > 1 && selectedDuplicateCount === duplicateItems.length) {
      setStatus("All files in this duplicate group are selected. Use Keep active, clean rest or deselect the keeper first.");
      return;
    }

    if (duplicateCleanupMode === "move" && !duplicateCleanupDestination.trim()) {
      setStatus("Choose a cleanup folder before moving duplicate files");
      return;
    }

    if (!duplicateCleanupConfirmed) {
      setStatus(
        duplicateCleanupMode === "delete"
          ? "Confirm duplicate deletion before running cleanup"
          : "Confirm duplicate move before running cleanup"
      );
      return;
    }

    setIsCleaningDuplicates(true);
    setStatus(
      duplicateCleanupMode === "delete"
        ? `Deleting ${selectedPaths.length.toLocaleString()} duplicate file(s)...`
        : `Moving ${selectedPaths.length.toLocaleString()} duplicate file(s) to cleanup folder...`
    );

    try {
      const result = await invoke<CleanupDuplicatesResponse>("cleanup_duplicates", {
        request: {
          mode: duplicateCleanupMode,
          collisionPolicy: duplicateCleanupCollisionPolicy,
          destinationFolder: duplicateCleanupMode === "move" ? duplicateCleanupDestination : null,
          paths: selectedPaths
        }
      });

      await initializeAppData();
      const refreshedDuplicates = await invoke<DuplicateScanResponse>("find_duplicates");
      setDuplicateGroups(refreshedDuplicates.groups);
      setDuplicateScanResult(refreshedDuplicates);
      setActiveDuplicateGroupKey(refreshedDuplicates.groups[0]?.key ?? null);
      setSelectedFileIds([]);
      setDuplicateCleanupConfirmed(false);

      if (duplicateCleanupMode === "delete") {
        setStatus(
          `Duplicate cleanup finished: ${result.deletedItems.toLocaleString()} deleted, ${result.failedItems.toLocaleString()} failed`
        );
      } else {
        setStatus(
          `Duplicate cleanup finished: ${result.movedItems.toLocaleString()} moved, ${result.renamedItems.toLocaleString()} renamed, ${result.skippedExisting.toLocaleString()} skipped existing, ${result.failedItems.toLocaleString()} failed`
        );
      }
    } catch (error) {
      setStatus(`Duplicate cleanup failed: ${String(error)}`);
    } finally {
      setIsCleaningDuplicates(false);
    }
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
    await refreshOperationHistory();
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

  function resetSettingsDefaults() {
    setSelectedExtensions([...availableExtensions]);
    setThumbnailSize("medium");
    setLibraryPageSize(50);
    setHistoryRetentionCount(200);
    setLogReportExports(true);
    setLogSuccessfulOperations(true);
    setStatus("Settings reset to default values in the UI");
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

        <div className="sidebar-block">
          <div className="block-title">
            <Copy size={16} />
            Tag Report
          </div>
          <div className="panel-note sidebar-report-note">
            <strong>{tags.length.toLocaleString()} tags tracked</strong>
            <span>
              {mediaFiles.filter((item) => item.tags.length && !item.missing).length.toLocaleString()} tagged files
              {selectedTagFilter ? ` | filter: ${selectedTagFilter}` : ""}
            </span>
          </div>
          <button className="secondary-button" onClick={() => void exportTagReport()} disabled={!tags.length}>
            <Copy size={16} />
            Export CSV
          </button>
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
                    : activeSection === "Move/Copy"
                      ? "Build a safe move or copy plan, choose a destination, and preview the resulting folder structure."
                      : "Set scan defaults, library defaults, and operational paths for the desktop app."}
            </p>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" onClick={initializeAppData} disabled={isBusy}>
              <RefreshCw size={17} />
              Reload library
            </button>
            {activeSection === "Settings" ? (
              <button className="secondary-button" onClick={openSettingsLogLocation} disabled={!appSettings}>
                <FolderOpen size={17} />
                Open log
              </button>
            ) : (
              <button
                className="secondary-button"
                onClick={() => runScan(false)}
                disabled={isBusy || activeSection === "Duplicates"}
                title={activeSection === "Duplicates" ? "Refresh scan is available from Scan, Library, or Move/Copy." : undefined}
              >
                <RefreshCw size={17} />
                Refresh scan
              </button>
            )}
            <button
              className="primary-button"
              onClick={
                activeSection === "Settings"
                  ? saveSettings
                  : activeSection === "Duplicates"
                  ? runDuplicateScan
                  : activeSection === "Move/Copy"
                    ? buildMovePreview
                    : () => runScan(true)
              }
              disabled={isBusy}
            >
              {activeSection === "Settings" ? (
                <Settings size={17} />
              ) : activeSection === "Duplicates" ? (
                <Hash size={17} />
              ) : activeSection === "Move/Copy" ? (
                <MoveRight size={17} />
              ) : (
                <ScanSearch size={17} />
              )}
              {activeSection === "Settings"
                ? "Save settings"
                : activeSection === "Duplicates"
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
                : activeSection === "Settings"
                  ? selectedExtensions.length
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
                : activeSection === "Settings"
                  ? `${libraryPageSize}`
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
                : activeSection === "Settings"
                  ? thumbnailSize
                : activeSection === "Move/Copy"
                  ? moveDestination
                    ? folderLabel(moveDestination)
                    : "Not set"
                : (scanResult?.missingFiles ?? mediaFiles.filter((file) => file.missing).length)}
            </strong>
          </div>
        </section>

        <div className="content-split" style={{ gridTemplateColumns: `${activeSplitWidth}px 7px minmax(0, 1fr)` }}>
          {activeSection === "Settings" ? (
            <>
              <section className="panel settings-panel">
                <div className="panel-header">
                  <div>
                    <h2>Scan Defaults</h2>
                    <p>Choose which file types are included by default whenever the app scans or refreshes selected paths.</p>
                  </div>
                  <Settings size={20} />
                </div>

                <div className="settings-scroll">
                  <div className="planner-section">
                    <strong>File types</strong>
                    <div className="extension-actions">
                      <button onClick={selectAllExtensions}>Select all</button>
                      <button onClick={deselectAllExtensions}>Deselect all</button>
                      <button onClick={resetSettingsDefaults}>Reset defaults</button>
                    </div>
                    <div className="panel-note">
                      <strong>{selectedExtensions.length} enabled extensions</strong>
                      <span>These defaults are shared with Scan, incremental refresh, and full rescans.</span>
                    </div>
                    <div className="settings-extension-groups">
                      {extensionGroups.map((group) => (
                        <div className="extension-group" key={`settings-${group.label}`}>
                          <strong>{group.label}</strong>
                          <div className="extension-checkboxes">
                            {group.extensions.map((extension) => (
                              <label key={`settings-${extension}`}>
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
                  </div>
                </div>
              </section>

              <div className="resize-rail subtle" aria-hidden="true" onMouseDown={(event) => beginSplitResize("Settings", event.clientX)} />

              <section className="panel settings-panel">
                <div className="panel-header">
                  <div>
                    <h2>App Defaults</h2>
                    <p>Set how the library opens by default and where the desktop app keeps its local cache and logs.</p>
                  </div>
                  <Database size={20} />
                </div>

                <div className="settings-scroll">
                  <div className="planner-section">
                    <strong>Library defaults</strong>
                    <div className="planner-grid">
                      <label>
                        <span>Default thumbnail size</span>
                        <select value={thumbnailSize} onChange={(event) => setThumbnailSize(event.target.value as ThumbnailSize)}>
                          {thumbnailSizes.map((size) => (
                            <option key={`thumb-${size}`} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Default items per page</span>
                        <select value={libraryPageSize} onChange={(event) => setLibraryPageSize(Number(event.target.value))}>
                          {libraryPageSizes.map((size) => (
                            <option key={`page-${size}`} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className="planner-section">
                    <strong>Operational paths</strong>
                    <div className="settings-path-list">
                      <label>
                        <span>App data directory</span>
                        <div>{appSettings?.appDataDir || "Loading..."}</div>
                      </label>
                      <label>
                        <span>Database</span>
                        <div>{appSettings?.databasePath || "Loading..."}</div>
                      </label>
                      <label>
                        <span>Startup log</span>
                        <div>{appSettings?.startupLogPath || "Loading..."}</div>
                      </label>
                    </div>
                  </div>

                  <div className="planner-section">
                    <strong>Logging</strong>
                    <div className="planner-grid">
                      <label>
                        <span>History retention</span>
                        <input
                          type="number"
                          min="25"
                          max="1000"
                          step="25"
                          value={historyRetentionCount}
                          onChange={(event) => setHistoryRetentionCount(Math.max(25, Math.min(1000, Number(event.target.value) || 25)))}
                        />
                      </label>
                    </div>
                    <div className="planner-choice-list">
                      <label>
                        <input
                          type="checkbox"
                          checked={logSuccessfulOperations}
                          onChange={(event) => setLogSuccessfulOperations(event.target.checked)}
                        />
                        Log successful operations in activity history
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={logReportExports}
                          onChange={(event) => setLogReportExports(event.target.checked)}
                        />
                        Log report exports in activity history
                      </label>
                    </div>
                    <div className="panel-note">
                      <strong>Operational history and startup logging</strong>
                      <span>The desktop layer keeps startup logs on disk and activity history in SQLite for scans, cleanup, exports, and file operations.</span>
                    </div>
                    <div className="detail-actions">
                      <button onClick={openSettingsLogLocation} disabled={!appSettings}>
                        <FolderOpen size={16} />
                        Open log location
                      </button>
                    </div>
                  </div>

                  <div className="planner-section">
                    <strong>Recent activity</strong>
                    <div className="panel-note">
                      <strong>{operationHistory.length.toLocaleString()} recent entries</strong>
                      <span>Scans, duplicate checks, settings saves, exports, and move/copy runs are logged here for quick review.</span>
                    </div>
                    <div className="detail-actions">
                      <button onClick={() => void exportActivityHistoryReport()} disabled={!operationHistory.length}>
                        <Copy size={16} />
                        Export history
                      </button>
                      <button onClick={() => void clearActivityHistory()} disabled={!operationHistory.length}>
                        <AlertCircle size={16} />
                        Clear history
                      </button>
                    </div>
                    <div className="history-list">
                      {operationHistory.length ? (
                        operationHistory.map((entry) => (
                          <article className={`history-card status-${entry.status}`} key={`history-${entry.id}`}>
                            <div className="history-card-header">
                              <strong>{formatOperationType(entry.operationType)}</strong>
                              <span>{formatDateTime(entry.createdAtUnix)}</span>
                            </div>
                            <div className="history-card-status">
                              <span className={`status-pill status-${entry.status}`}>{entry.status}</span>
                            </div>
                            <p>{entry.summary}</p>
                            {entry.details ? <small>{entry.details}</small> : null}
                          </article>
                        ))
                      ) : (
                        <div className="empty-state wide">No activity has been recorded yet.</div>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : null}
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
                      <strong>Destination collisions</strong>
                      <div className="planner-choice-list">
                        <label>
                          <input
                            type="radio"
                            checked={moveCollisionPolicy === "skip"}
                            onChange={() => setMoveCollisionPolicy("skip")}
                          />
                          Skip existing destination files
                        </label>
                        <label>
                          <input
                            type="radio"
                            checked={moveCollisionPolicy === "rename"}
                            onChange={() => setMoveCollisionPolicy("rename")}
                          />
                          Rename new copy when destination exists
                        </label>
                      </div>
                      <div className="planner-note-inline">
                        {moveCollisionPolicy === "skip"
                          ? "Existing destination files are left untouched and skipped during execution."
                          : "If the destination already exists, execution appends a numeric suffix like (1) to the new file."}
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
                      <div className="planner-note-inline">Choose up to four folder levels in any order. Default is Year taken, Month taken, File type, Primary tag.</div>
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
                      <span>
                        {movePreviewItems.length
                          ? `${movePreviewItems.length.toLocaleString()} preview rows built with ${moveCollisionPolicy === "skip" ? "skip-existing" : "rename-on-collision"} execution`
                          : "Build preview to inspect source and destination paths."}
                      </span>
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

              <div className="resize-rail subtle" aria-hidden="true" onMouseDown={(event) => beginSplitResize("Move/Copy", event.clientX)} />

              <section className="panel library-panel move-preview-panel">
                <div className="panel-header">
                  <div>
                    <h2>Move/Copy Preview</h2>
                    <p>Review where each file would land before any real file operations are enabled.</p>
                  </div>
                  <div className="view-actions">
                    <button onClick={executeMoveCopyPlan} disabled={!movePreviewItems.length || isBusy}>
                      <MoveRight size={16} />
                      {isExecutingMoveCopy ? "Running..." : `Execute ${moveMode}`}
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

                {lastMoveExecutionReport ? (
                  <div className="planner-section move-report-section">
                    <div className="move-report-header">
                      <strong>Last execution report</strong>
                      <button onClick={() => void exportMoveExecutionReport()}>
                        <Copy size={16} />
                        Export CSV
                      </button>
                    </div>
                    <div className="move-report-summary">
                      <span>{formatDateTime(lastMoveExecutionReport.executedAtUnix)}</span>
                      <span>{lastMoveExecutionReport.mode} / {lastMoveExecutionReport.collisionPolicy}</span>
                      <span>{lastMoveExecutionReport.summary.processedItems.toLocaleString()} processed</span>
                      <span>
                        {(lastMoveExecutionReport.mode === "copy"
                          ? lastMoveExecutionReport.summary.copiedItems
                          : lastMoveExecutionReport.summary.movedItems).toLocaleString()} completed
                      </span>
                      <span>{lastMoveExecutionReport.summary.renamedItems.toLocaleString()} renamed</span>
                      <span>{lastMoveExecutionReport.summary.failedItems.toLocaleString()} failed</span>
                    </div>
                  </div>
                ) : null}

                <div className="move-preview-table data-grid" role="table" aria-label="Move copy preview">
                  {renderGridHeader(["Name", "Action", "Source", "Destination"], "move", gridColumnWidths.move, beginGridColumnResize, "move-preview-row")}
                  {movePreviewItems.length ? (
                    movePreviewItems.map((item) => (
                      <div
                        className="data-grid-row move-preview-row"
                        role="row"
                        key={`${item.id}-${item.destinationPath}`}
                        style={{ gridTemplateColumns: buildGridTemplate(gridColumnWidths.move) }}
                      >
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

              <div className="resize-rail subtle" aria-hidden="true" onMouseDown={(event) => beginSplitResize("Duplicates", event.clientX)} />

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
                  <button onClick={keepActiveAndPrepareCleanup} disabled={!duplicateItems.length || !activeMediaItem}>
                    Keep active, clean rest
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

                <div className="planner-section duplicate-cleanup-panel">
                  <strong>Duplicate cleanup</strong>
                  <div className="planner-toggle">
                    <button
                      className={duplicateCleanupMode === "move" ? "active" : ""}
                      onClick={() => setDuplicateCleanupMode("move")}
                    >
                      Move to cleanup folder
                    </button>
                    <button
                      className={duplicateCleanupMode === "delete" ? "active" : ""}
                      onClick={() => setDuplicateCleanupMode("delete")}
                    >
                      Delete from disk
                    </button>
                  </div>

                  {duplicateCleanupMode === "move" ? (
                    <>
                      <div className="planner-choice-list">
                        <label>
                          <input
                            type="radio"
                            checked={duplicateCleanupCollisionPolicy === "skip"}
                            onChange={() => setDuplicateCleanupCollisionPolicy("skip")}
                          />
                          Skip existing files in cleanup folder
                        </label>
                        <label>
                          <input
                            type="radio"
                            checked={duplicateCleanupCollisionPolicy === "rename"}
                            onChange={() => setDuplicateCleanupCollisionPolicy("rename")}
                          />
                          Rename moved file when cleanup target exists
                        </label>
                      </div>
                      <div className="planner-destination">
                        <div>
                          <span>{duplicateCleanupDestination || "No cleanup folder selected yet"}</span>
                        </div>
                        <button onClick={chooseDuplicateCleanupDestination}>
                          <FolderOpen size={16} />
                          Choose folder
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="panel-note duplicate-warning-note">
                      <strong>Permanent delete</strong>
                      <span>Selected duplicate files will be removed from disk and marked missing in the local scan cache.</span>
                    </div>
                  )}

                  <div className="panel-note duplicate-preflight-note">
                    <strong>Preflight summary</strong>
                    <span>
                      {activeMediaItem && duplicateItemIds.includes(activeMediaItem.id)
                        ? `Keeping ${activeMediaItem.filename}`
                        : "No keeper chosen yet"}
                    </span>
                    <span>
                      {selectedDuplicateCount.toLocaleString()} cleanup item(s) selected
                      {selectedDuplicateCount ? ` | ${formatFileSize(selectedDuplicateBytes)} estimated` : ""}
                    </span>
                    <span>
                      {duplicateCleanupMode === "move"
                        ? duplicateCleanupDestination
                          ? `Move extras to ${duplicateCleanupDestination}`
                          : "Choose a cleanup folder to move extras"
                        : "Delete selected extras from disk"}
                    </span>
                    {duplicateItems.length > 1 && selectedDuplicateCount === duplicateItems.length ? (
                      <span className="duplicate-preflight-warning">
                        All files in this duplicate group are selected right now. Choose a keeper before cleanup.
                      </span>
                    ) : null}
                    {activeDuplicateIsSelected ? (
                      <span className="duplicate-preflight-warning">
                        The active file is included in the cleanup selection.
                      </span>
                    ) : null}
                  </div>

                  <label className="duplicate-confirmation">
                    <input
                      type="checkbox"
                      checked={duplicateCleanupConfirmed}
                      onChange={(event) => setDuplicateCleanupConfirmed(event.target.checked)}
                    />
                    <span>
                      {duplicateCleanupMode === "delete"
                        ? "I understand these selected duplicate files will be deleted from disk."
                        : "I understand these selected duplicate files will be moved out of the current library view."}
                    </span>
                  </label>

                  <div className="detail-actions">
                    <button onClick={runDuplicateCleanup} disabled={!selectedDuplicateCount || isCleaningDuplicates}>
                      <AlertCircle size={16} />
                      {isCleaningDuplicates
                        ? "Running cleanup..."
                        : duplicateCleanupMode === "delete"
                          ? "Delete selected duplicates"
                          : "Move selected duplicates"}
                    </button>
                  </div>
                </div>

                <div
                  className={`library-workbench duplicate-review-workbench ${detailPanelOpen ? "" : "details-collapsed"}`}
                  style={detailPanelOpen ? { gridTemplateColumns: `minmax(0, 1fr) 7px ${detailPanelWidth}px` } : undefined}
                >
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
                      {renderGridHeader(
                        ["Select", "Name", "Type", "Size", "Date taken", "Path", "Tags"],
                        "duplicate",
                        gridColumnWidths.duplicate,
                        beginGridColumnResize,
                        "duplicate-grid-row"
                      )}
                      {duplicateItems.map((item) => (
                        <div
                          className={`data-grid-row duplicate-grid-row ${selectedFileIds.includes(item.id) ? "selected" : ""}`}
                          role="row"
                          key={`${item.path}-duplicate-row`}
                          onClick={() => activateMediaFile(item.id)}
                          style={{ gridTemplateColumns: buildGridTemplate(gridColumnWidths.duplicate) }}
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
                    <div
                      className="detail-resize-rail"
                      aria-label="Resize details panel"
                      onMouseDown={(event) => beginDetailResize(event.clientX)}
                    />
                  ) : null}
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
                          <span><Clock3 size={14} /> Date source</span>
                          <strong>{activeMediaItem.dateSource || "Unknown source"}</strong>
                        </div>
                        <div className="detail-row">
                          <span><CalendarClock size={14} /> Created</span>
                          <strong>{formatDate(activeMediaItem.createdUnix)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><CalendarClock size={14} /> Modified</span>
                          <strong>{formatDate(activeMediaItem.modifiedUnix)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><Folder size={14} /> Folder</span>
                          <strong>{fileFolderPath(activeMediaItem.path)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><HardDrive size={14} /> Scan root</span>
                          <strong>{activeMediaItem.scanRoot}</strong>
                        </div>
                        {activeMediaItem.mediaType === "video" ? <VideoDetailRows item={activeMediaItem} /> : null}
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
              {activeSection === "Library" ? (
                <>
                  <button onClick={selectFilesInSelectedFolders} disabled={!selectedFolderFileIds.length}>
                    Select files
                  </button>
                  <button onClick={clearFilesInSelectedFolders} disabled={!selectedFolderFileIds.length}>
                    Clear files
                  </button>
                </>
              ) : null}
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
                {lastScanExecutionReport ? (
                  <div className="planner-section move-report-section">
                    <div className="move-report-header">
                      <strong>Last scan report</strong>
                      <button onClick={() => void exportScanSummaryReport()}>
                        <Copy size={16} />
                        Export CSV
                      </button>
                    </div>
                    <div className="move-report-summary">
                      <span>{formatDateTime(lastScanExecutionReport.executedAtUnix)}</span>
                      <span>{lastScanExecutionReport.mode === "full" ? "Full scan" : "Refresh scan"}</span>
                      <span>{lastScanExecutionReport.paths.length.toLocaleString()} paths</span>
                      <span>{lastScanExecutionReport.extensions.length.toLocaleString()} file types</span>
                      <span>{lastScanExecutionReport.result.scannedFiles.toLocaleString()} processed</span>
                      <span>{lastScanExecutionReport.result.missingFiles.toLocaleString()} missing</span>
                    </div>
                  </div>
                ) : null}
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
              <div className="planner-section move-report-section">
                <div className="move-report-header">
                  <strong>Library report</strong>
                  <button onClick={() => void exportLibraryReport()}>
                    <Copy size={16} />
                    Export CSV
                  </button>
                </div>
                <div className="move-report-summary">
                  <span>{visibleMediaFiles.length.toLocaleString()} visible files</span>
                  <span>{activeFolderFilterCount}/{allFolderPaths.length || 0} folders selected</span>
                  <span>tag: {selectedTagFilter ?? "none"}</span>
                  <span>{movePreviewItems.length.toLocaleString()} planned destination rows</span>
                </div>
              </div>
            )}
          </section>

          <div
            className="resize-rail subtle"
            aria-hidden="true"
            onMouseDown={(event) => beginSplitResize(activeSection === "Library" ? "Library" : "Scan", event.clientX)}
          />
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
              <button onClick={() => setShowAdvancedFilters((current) => !current)}>
                <Filter size={16} />
                {showAdvancedFilters ? "Hide filters" : "Filters"}
              </button>
              <button onClick={selectVisibleFiles} disabled={!visibleMediaFiles.some((item) => !item.missing)}>
                Select visible
              </button>
              <button onClick={clearVisibleFiles} disabled={!selectedFileIds.length || !visibleMediaFiles.length}>
                Clear visible
              </button>
            </div>
            {showAdvancedFilters ? (
              <div className="advanced-filter-row">
                <label className="select-filter">
                  <span>Media</span>
                  <select value={mediaTypeFilter} onChange={(event) => setMediaTypeFilter(event.target.value as MediaTypeFilter)}>
                    <option value="all">All media</option>
                    <option value="image">Images</option>
                    <option value="video">Videos</option>
                  </select>
                </label>
                <label className="select-filter">
                  <span>Extension</span>
                  <select value={extensionFilter} onChange={(event) => setExtensionFilter(event.target.value)}>
                    <option value="all">All extensions</option>
                    {extensionFilterOptions.map((extension) => (
                      <option key={extension} value={extension}>
                        .{extension}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="select-filter">
                  <span>Missing</span>
                  <select
                    value={missingFilterMode}
                    onChange={(event) => setMissingFilterMode(event.target.value as MissingFilterMode)}
                  >
                    <option value="hide">Hide missing</option>
                    <option value="include">Include missing</option>
                    <option value="only">Only missing</option>
                  </select>
                </label>
                <label className="tag-filter-field">
                  <span>Tags</span>
                  <input
                    placeholder="family, vacation"
                    value={tagFilterInput}
                    list="known-tags"
                    onChange={(event) => setTagFilterInput(event.target.value)}
                  />
                </label>
                <label className="select-filter">
                  <span>Match</span>
                  <select value={tagMatchMode} onChange={(event) => setTagMatchMode(event.target.value as TagMatchMode)}>
                    <option value="any">Any tag</option>
                    <option value="all">All tags</option>
                  </select>
                </label>
                <label className="date-filter-field">
                  <span>From</span>
                  <input type="date" value={dateFromInput} onChange={(event) => setDateFromInput(event.target.value)} />
                </label>
                <label className="date-filter-field">
                  <span>To</span>
                  <input type="date" value={dateToInput} onChange={(event) => setDateToInput(event.target.value)} />
                </label>
                <label className="number-filter-field">
                  <span>Min MB</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={minFileSizeMb}
                    onChange={(event) => setMinFileSizeMb(event.target.value)}
                  />
                </label>
                <label className="number-filter-field">
                  <span>Max MB</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={maxFileSizeMb}
                    onChange={(event) => setMaxFileSizeMb(event.target.value)}
                  />
                </label>
                <label className="number-filter-field">
                  <span>Min MP</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={minMegapixels}
                    onChange={(event) => setMinMegapixels(event.target.value)}
                  />
                </label>
                <label className="number-filter-field">
                  <span>Max MP</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={maxMegapixels}
                    onChange={(event) => setMaxMegapixels(event.target.value)}
                  />
                </label>
                <label className="select-filter">
                  <span>Date source</span>
                  <select value={dateSourceFilter} onChange={(event) => setDateSourceFilter(event.target.value as DateSourceFilter)}>
                    <option value="all">All sources</option>
                    <option value="metadata">Metadata</option>
                    <option value="filesystem-created">Filesystem created</option>
                    <option value="filesystem-modified">Filesystem modified</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label className="select-filter preset-select">
                  <span>Preset</span>
                  <select
                    value={selectedFilterPresetName}
                    onChange={(event) => {
                      setSelectedFilterPresetName(event.target.value);
                      if (event.target.value) {
                        setFilterPresetDraftName(event.target.value);
                      }
                    }}
                  >
                    <option value="">Saved presets</option>
                    {filterPresets.map((preset) => (
                      <option key={preset.name} value={preset.name}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={() => applyFilterPreset(selectedFilterPresetName)} disabled={!selectedFilterPresetName}>
                  Apply preset
                </button>
                <label className="tag-filter-field preset-name-field">
                  <span>Save as</span>
                  <input
                    placeholder="Weekend review"
                    value={filterPresetDraftName}
                    onChange={(event) => setFilterPresetDraftName(event.target.value)}
                  />
                </label>
                <button onClick={saveFilterPreset}>Save preset</button>
                <button onClick={deleteFilterPreset} disabled={!selectedFilterPresetName}>
                  Delete preset
                </button>
                <button onClick={resetAdvancedFilters}>Reset filters</button>
              </div>
            ) : null}

            <div
              className={
                activeSection === "Library"
                  ? `library-workbench ${detailPanelOpen ? "" : "details-collapsed"}`
                  : "scan-workbench"
              }
              style={
                activeSection === "Library" && detailPanelOpen
                  ? { gridTemplateColumns: `minmax(0, 1fr) 7px ${detailPanelWidth}px` }
                  : undefined
              }
            >
              <div className="library-main">
                    <div
                      className={`media-grid thumb-size-${thumbnailSize} ${
                        activeSection === "Library" ? "library-grid" : "scan-grid"
                      }`}
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
              {renderGridHeader(["Select", "Name", "Type", "Size", "Date taken", "Path"], "media", gridColumnWidths.media, beginGridColumnResize)}
              {gridMediaFiles.map((item) => (
                <div
                  className={`data-grid-row ${selectedFileIds.includes(item.id) ? "selected" : ""}`}
                  role="row"
                  key={`${item.path}-row`}
                  onClick={() => activateMediaFile(item.id)}
                  style={{ gridTemplateColumns: buildGridTemplate(gridColumnWidths.media) }}
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
                <div
                  className="detail-resize-rail"
                  aria-label="Resize details panel"
                  onMouseDown={(event) => beginDetailResize(event.clientX)}
                />
              ) : null}
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
                          <span><Clock3 size={14} /> Date source</span>
                          <strong>{activeMediaItem.dateSource || "Unknown source"}</strong>
                        </div>
                        <div className="detail-row">
                          <span><CalendarClock size={14} /> Created</span>
                          <strong>{formatDate(activeMediaItem.createdUnix)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><CalendarClock size={14} /> Modified</span>
                          <strong>{formatDate(activeMediaItem.modifiedUnix)}</strong>
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
                          <span><Grid3X3 size={14} /> Megapixels</span>
                          <strong>{activeMediaItem.megapixels !== null ? `${activeMediaItem.megapixels} MP` : "Unknown"}</strong>
                        </div>
                        {activeMediaItem.mediaType === "video" ? <VideoDetailRows item={activeMediaItem} /> : null}
                        <div className="detail-row">
                          <span><Clock3 size={14} /> Scanned</span>
                          <strong>{formatDate(activeMediaItem.scannedAtUnix)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><Folder size={14} /> Folder</span>
                          <strong>{fileFolderPath(activeMediaItem.path)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><HardDrive size={14} /> Scan root</span>
                          <strong>{activeMediaItem.scanRoot}</strong>
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
            {activeSection === "Settings" ? (
              <>
                <span>{selectedExtensions.length}/{availableExtensions.length} file types</span>
                <span>thumb: {thumbnailSize}</span>
                <span>page size: {libraryPageSize}</span>
              </>
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

function formatDateTime(unixSeconds: number | null) {
  if (!unixSeconds) {
    return "Unknown time";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(unixSeconds * 1000);
}

function formatOperationType(operationType: string) {
  switch (operationType) {
    case "full_scan":
      return "Full scan";
    case "refresh_scan":
      return "Refresh scan";
    case "duplicate_scan":
      return "Duplicate check";
    case "move_copy_execute":
      return "Move/Copy execution";
    case "settings_save":
      return "Settings saved";
    case "export_report":
      return "Report export";
    default:
      return operationType
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
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
    case "dayTaken":
      return formatMoveDay(resolveMoveDate(item, "taken"), "Unknown Day");
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

function formatMoveDay(date: Date | null, fallback: string) {
  return date ? `${String(date.getDate()).padStart(2, "0")}` : fallback;
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

function buildGridTemplate(widths: number[]) {
  return widths.map((width) => `minmax(0, ${width}px)`).join(" ");
}

function renderGridHeader(
  labels: string[],
  set: GridColumnSet,
  widths: number[],
  beginResize: (set: GridColumnSet, index: number, clientX: number) => void,
  className?: string
) {
  return (
    <div
      className={`data-grid-row header ${className ?? ""}`.trim()}
      role="row"
      style={{ gridTemplateColumns: buildGridTemplate(widths) }}
    >
      {labels.map((label, index) => (
        <span className="grid-header-cell" key={`${set}-${label}-${index}`}>
          <span>{label}</span>
          {index < labels.length - 1 ? (
            <button
              className="column-resize-handle"
              aria-label={`Resize ${label} column`}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginResize(set, index, event.clientX);
              }}
            />
          ) : null}
        </span>
      ))}
    </div>
  );
}

function formatDimensions(item: MediaFile) {
  if (!item.width || !item.height) {
    return "Unknown dimensions";
  }

  return `${item.width} x ${item.height} - ${item.megapixels ?? "?"} MP`;
}

function parseFilterNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDateSourceFilter(dateSource: string | null): DateSourceFilter {
  const normalized = (dateSource ?? "").trim().toLowerCase();
  if (normalized.startsWith("metadata") || normalized.startsWith("filename")) {
    return "metadata";
  }
  if (normalized === "filesystem created" || normalized === "filesystem-created") {
    return "filesystem-created";
  }
  if (normalized === "filesystem modified" || normalized === "filesystem-modified") {
    return "filesystem-modified";
  }
  return normalized ? "unknown" : "unknown";
}

function PreviewImage({ item }: { item: MediaFile }) {
  const [failed, setFailed] = useState(false);
  const canPreview = !item.missing && canPreviewExtension(item.extension);

  if (item.mediaType === "video" && canVideoPreviewExtension(item.extension)) {
    return <VideoThumbnail item={item} />;
  }

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

function VideoThumbnail({ item }: { item: MediaFile }) {
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (item.missing || !canVideoPreviewExtension(item.extension)) {
      setThumbnailSrc(null);
      return;
    }

    let canceled = false;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const handleError = () => {
      if (!canceled) {
        setFailed(true);
      }
      cleanup();
    };

    const captureFrame = () => {
      if (canceled) {
        cleanup();
        return;
      }

      const width = video.videoWidth || 320;
      const height = video.videoHeight || 180;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");

      if (!context) {
        handleError();
        return;
      }

      context.fillStyle = "#f8f7f3";
      context.fillRect(0, 0, width, height);
      context.drawImage(video, 0, 0, width, height);

      if (!canceled) {
        setThumbnailSrc(canvas.toDataURL("image/jpeg", 0.82));
      }

      cleanup();
    };

    video.addEventListener("error", handleError, { once: true });
    video.addEventListener(
      "loadeddata",
      () => {
        const seekTarget = Number.isFinite(video.duration) && video.duration > 0.25 ? 0.25 : 0;
        if (seekTarget > 0) {
          const onSeeked = () => captureFrame();
          video.addEventListener("seeked", onSeeked, { once: true });
          try {
            video.currentTime = seekTarget;
          } catch {
            captureFrame();
          }
        } else {
          captureFrame();
        }
      },
      { once: true }
    );

    video.src = convertFileSrc(item.path);

    return () => {
      canceled = true;
      cleanup();
    };
  }, [item.extension, item.missing, item.path]);

  if (failed) {
    return <Film size={34} />;
  }

  if (thumbnailSrc) {
    return <img src={thumbnailSrc} alt="" className="video-thumb-image" loading="lazy" />;
  }

  return <div className="video-thumb-placeholder"><Film size={30} /></div>;
}

function VideoDetailRows({ item }: { item: MediaFile }) {
  const metadata = useVideoMetadata(item);

  return (
    <>
      <div className="detail-row">
        <span><Film size={14} /> Duration</span>
        <strong>{metadata.durationSeconds !== null ? formatDuration(metadata.durationSeconds) : "Loading duration..."}</strong>
      </div>
      <div className="detail-row">
        <span><Grid3X3 size={14} /> Video frame</span>
        <strong>
          {metadata.width && metadata.height
            ? `${metadata.width} x ${metadata.height}`
            : "Loading frame size..."}
        </strong>
      </div>
    </>
  );
}

function useVideoMetadata(item: MediaFile | null) {
  const [metadata, setMetadata] = useState<{ durationSeconds: number | null; width: number | null; height: number | null }>({
    durationSeconds: null,
    width: null,
    height: null
  });

  useEffect(() => {
    if (!item || item.missing || item.mediaType !== "video" || !canVideoPreviewExtension(item.extension)) {
      setMetadata({ durationSeconds: null, width: null, height: null });
      return;
    }

    let canceled = false;
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };

    const finish = () => {
      if (!canceled) {
        setMetadata({
          durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null
        });
      }
      cleanup();
    };

    const fail = () => {
      if (!canceled) {
        setMetadata({ durationSeconds: null, width: null, height: null });
      }
      cleanup();
    };

    video.addEventListener("loadedmetadata", finish, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.src = convertFileSrc(item.path);

    return () => {
      canceled = true;
      cleanup();
    };
  }, [item]);

  return metadata;
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

function formatDuration(durationSeconds: number) {
  const roundedSeconds = Math.max(0, Math.round(durationSeconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const seconds = roundedSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function buildFolderTree(scanPaths: string[], scanFolders: ScanFolder[], mediaFiles: MediaFile[]) {
  const countByFolder = new Map<string, number>();
  for (const file of mediaFiles.filter((item) => !item.missing)) {
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
