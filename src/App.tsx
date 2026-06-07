import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
import { memo, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

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
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  aperture: string | null;
  focalLength: string | null;
  isoValue: string | null;
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
  totalFilesSeen: number;
  supportedFilesSeen: number;
  foldersVisited: number;
  errors: string[];
};

type ScanProgress = {
  stage: string;
  scanRoot: string | null;
  currentPath: string | null;
  foldersVisited: number;
  totalFilesSeen: number;
  supportedFilesSeen: number;
  filesDiscovered: number;
  scannedFiles: number;
  skippedUnchanged: number;
  errorsCount: number;
};

type ScanExecutionReport = {
  mode: "refresh" | "full";
  startedAtUnix: number;
  executedAtUnix: number;
  durationSeconds: number;
  paths: string[];
  extensions: string[];
  result: ScanResponse;
};

type DuplicateScanProgress = {
  stage: string;
  candidates: number;
  processed: number;
  groupsFound: number;
  hashedFiles: number;
  currentPath: string | null;
};

type DuplicateMatchMode = "exact" | "probable";

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
  matchMode: DuplicateMatchMode;
  groups: DuplicateGroup[];
  duplicateFiles: number;
  wastedSizeBytes: number;
  wastedSizeMb: number;
  hashedFiles: number;
  skippedInaccessibleFiles: number;
};

type DuplicateHashWarmResponse = {
  candidates: number;
  processed: number;
  hashedFiles: number;
  skippedInaccessibleFiles: number;
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
  appVersion: string;
  appIdentifier: string;
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

type VideoMetadataResult = {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  durationLabel: string | null;
  bitrateLabel: string | null;
  codec: string | null;
};

type PreviewWarmProgress = {
  total: number;
  processed: number;
  available: number;
  failed: number;
  currentFilename: string | null;
  running: boolean;
};

type IndexedMediaFile = {
  file: MediaFile;
  folderPath: string;
  extensionLower: string;
  normalizedTags: string[];
  searchText: string;
  takenTime: number | null;
  normalizedDateSource: DateSourceFilter;
};

type LimitedQueue = {
  active: number;
  limit: number;
  pending: Array<() => void>;
};

const videoThumbnailCache = new Map<string, string | null>();
const videoThumbnailInflight = new Map<string, Promise<string | null>>();
const videoMetadataCache = new Map<string, VideoMetadataResult>();
const videoMetadataInflight = new Map<string, Promise<VideoMetadataResult>>();
const nativeImagePreviewCache = new Map<string, string | null>();
const nativeImagePreviewInflight = new Map<string, Promise<string | null>>();
const imageMetadataHydrationAttempts = new Set<number>();
const videoThumbnailQueue: LimitedQueue = { active: 0, limit: 2, pending: [] };
const videoMetadataQueue: LimitedQueue = { active: 0, limit: 2, pending: [] };
const nativeImagePreviewQueue: LimitedQueue = { active: 0, limit: 2, pending: [] };
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

function VirtualDataGrid<T>({
  labels,
  columnSet,
  columnWidths,
  items,
  rowClassName,
  rowHeight = 38,
  emptyMessage,
  getRowKey,
  getRowClassName,
  renderCells,
  onRowClick,
  onBeginResize
}: {
  labels: string[];
  columnSet: GridColumnSet;
  columnWidths: number[];
  items: T[];
  rowClassName?: string;
  rowHeight?: number;
  emptyMessage: string;
  getRowKey: (item: T, index: number) => string;
  getRowClassName?: (item: T, index: number) => string;
  renderCells: (item: T, index: number) => ReactNode[];
  onRowClick?: (item: T, index: number) => void;
  onBeginResize: (set: GridColumnSet, index: number, clientX: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateHeight = () => setViewportHeight(element.clientHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const overscan = 8;
  const visibleStart = Math.max(0, Math.floor((scrollTop - rowHeight) / rowHeight) - overscan);
  const visibleEnd = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan);
  const visibleItems = items.slice(visibleStart, visibleEnd);
  const template = buildGridTemplate(columnWidths);

  return (
    <div
      className="data-grid virtualized-grid"
      role="table"
      ref={containerRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {renderGridHeader(labels, columnSet, columnWidths, onBeginResize, rowClassName)}
      {items.length ? (
        <div className="virtual-grid-body" style={{ height: items.length * rowHeight }}>
          {visibleItems.map((item, index) => {
            const itemIndex = visibleStart + index;
            return (
              <div
                className={`data-grid-row ${rowClassName ?? ""} ${getRowClassName?.(item, itemIndex) ?? ""}`.trim()}
                role="row"
                key={getRowKey(item, itemIndex)}
                onClick={onRowClick ? () => onRowClick(item, itemIndex) : undefined}
                style={{
                  gridTemplateColumns: template,
                  top: itemIndex * rowHeight,
                  height: rowHeight
                }}
              >
                {renderCells(item, itemIndex)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state wide">{emptyMessage}</div>
      )}
    </div>
  );
}

function VirtualMediaGrid<T>({
  items,
  width,
  height,
  className,
  emptyMessage,
  getItemKey,
  renderItem
}: {
  items: T[];
  width: number;
  height: number;
  className?: string;
  emptyMessage: string;
  getItemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const [viewportWidth, setViewportWidth] = useState(width);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      setViewportHeight(element.clientHeight);
      setViewportWidth(element.clientWidth);
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const gap = 12;
  const columnWidth = width + gap;
  const rowHeight = height + gap;
  const columns = Math.max(1, Math.floor((viewportWidth + gap) / columnWidth));
  const totalRows = Math.ceil(items.length / columns);
  const overscanRows = 2;
  const visibleStartRow = Math.max(0, Math.floor(scrollTop / rowHeight) - overscanRows);
  const visibleEndRow = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscanRows);
  const startIndex = visibleStartRow * columns;
  const endIndex = Math.min(items.length, visibleEndRow * columns);
  const visibleItems = items.slice(startIndex, endIndex);
  const bodyHeight = totalRows > 0 ? totalRows * rowHeight - gap : 0;

  return (
    <div
      className={`media-grid virtualized-media-grid ${className ?? ""}`.trim()}
      ref={containerRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      {items.length ? (
        <div className="virtual-media-grid-body" style={{ height: bodyHeight }}>
          {visibleItems.map((item, index) => {
            const itemIndex = startIndex + index;
            const row = Math.floor(itemIndex / columns);
            const column = itemIndex % columns;

            return (
              <div
                className="virtual-media-grid-item"
                key={getItemKey(item, itemIndex)}
                style={{
                  width,
                  height,
                  left: column * columnWidth,
                  top: row * rowHeight
                }}
              >
                {renderItem(item, itemIndex)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state wide">{emptyMessage}</div>
      )}
    </div>
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
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [lastScanExecutionReport, setLastScanExecutionReport] = useState<ScanExecutionReport | null>(null);
  const [previewWarmProgress, setPreviewWarmProgress] = useState<PreviewWarmProgress | null>(null);
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
  const [libraryTableOpen, setLibraryTableOpen] = useState(true);
  const [libraryTableHeight, setLibraryTableHeight] = useState<number>(320);
  const [scanTableHeight, setScanTableHeight] = useState<number>(320);
  const [activeMediaId, setActiveMediaId] = useState<number | null>(null);
  const [magnifiedMediaId, setMagnifiedMediaId] = useState<number | null>(null);
  const [detailPanelOpen, setDetailPanelOpen] = useState(true);
  const [detailPanelWidth, setDetailPanelWidth] = useState(320);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateScanResult, setDuplicateScanResult] = useState<DuplicateScanResponse | null>(null);
  const [duplicateScanProgress, setDuplicateScanProgress] = useState<DuplicateScanProgress | null>(null);
  const [activeDuplicateGroupKey, setActiveDuplicateGroupKey] = useState<string | null>(null);
  const [isFindingDuplicates, setIsFindingDuplicates] = useState(false);
  const [duplicateMatchMode, setDuplicateMatchMode] = useState<DuplicateMatchMode>("exact");
  const [isWarmingDuplicateHashes, setIsWarmingDuplicateHashes] = useState(false);
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
  const [duplicateMovePanelOpen, setDuplicateMovePanelOpen] = useState(false);
  const [deleteDuplicateConfirmOpen, setDeleteDuplicateConfirmOpen] = useState(false);
  const [skipDeleteWarningThisSession, setSkipDeleteWarningThisSession] = useState(false);
  const [skipDeleteWarningDraft, setSkipDeleteWarningDraft] = useState(false);
  const detailResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const libraryTableResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const scanTableResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [panelSplitWidths, setPanelSplitWidths] = useState<Record<SplitSection, number>>({
    Scan: 420,
    Library: 420,
    Duplicates: 360,
    "Move/Copy": 400,
    Settings: 420
  });
  const splitResizeRef = useRef<{ section: SplitSection; startX: number; startWidth: number } | null>(null);
  const previewWarmRunRef = useRef(0);
  const [gridColumnWidths, setGridColumnWidths] = useState<Record<GridColumnSet, number[]>>({
    media: [52, 240, 90, 96, 128, 420],
    duplicate: [52, 220, 90, 96, 128, 360, 220],
    move: [220, 240, 360, 420]
  });
  const gridResizeRef = useRef<{ set: GridColumnSet; index: number; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    void initializeAppData();
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    void listen<ScanProgress>("scan-progress", (event) => {
      if (!active) {
        return;
      }
      setScanProgress(event.payload);
      setStatus(formatScanProgressStatus(event.payload));
    }).then((dispose) => {
      if (!active) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | null = null;

    void listen<DuplicateScanProgress>("duplicate-progress", (event) => {
      if (!active) {
        return;
      }
      setDuplicateScanProgress(event.payload);
      if (isFindingDuplicates || isWarmingDuplicateHashes) {
        setStatus(formatDuplicateProgressStatus(event.payload));
      }
    }).then((dispose) => {
      if (!active) {
        dispose();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [isFindingDuplicates, isWarmingDuplicateHashes]);

  const extensionGroups = useMemo(() => groupExtensions(availableExtensions), [availableExtensions]);
  const extensionFilterOptions = useMemo(
    () => [...new Set(mediaFiles.map((file) => file.extension.toLowerCase()))].sort(),
    [mediaFiles]
  );
  const selectedFileIdSet = useMemo(() => new Set(selectedFileIds), [selectedFileIds]);
  const deferredSearchText = useDeferredValue(searchText);
  const deferredTagFilterInput = useDeferredValue(tagFilterInput);
  const deferredDateFromInput = useDeferredValue(dateFromInput);
  const deferredDateToInput = useDeferredValue(dateToInput);
  const parsedTagFilters = useMemo(
    () =>
      deferredTagFilterInput
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    [deferredTagFilterInput]
  );
  const parsedMinFileSizeMb = useMemo(() => parseFilterNumber(minFileSizeMb), [minFileSizeMb]);
  const parsedMaxFileSizeMb = useMemo(() => parseFilterNumber(maxFileSizeMb), [maxFileSizeMb]);
  const parsedMinMegapixels = useMemo(() => parseFilterNumber(minMegapixels), [minMegapixels]);
  const parsedMaxMegapixels = useMemo(() => parseFilterNumber(maxMegapixels), [maxMegapixels]);
  const selectedTagFilterLower = useMemo(() => selectedTagFilter?.toLowerCase() ?? null, [selectedTagFilter]);
  const mediaIndex = useMemo<IndexedMediaFile[]>(
    () =>
      mediaFiles.map((file) => ({
        file,
        folderPath: fileFolderPath(file.path),
        extensionLower: file.extension.toLowerCase(),
        normalizedTags: file.tags.map((tag) => tag.toLowerCase()),
        searchText: [file.filename, file.extension, file.mediaType, file.path, file.scanRoot, file.tags.join(" ")]
          .join(" ")
          .toLowerCase(),
        takenTime: resolveMoveDate(file, "taken")?.getTime() ?? null,
        normalizedDateSource: normalizeDateSourceFilter(file.dateSource)
      })),
    [mediaFiles]
  );
  const mediaSearchTextById = useMemo(() => new Map(mediaIndex.map((entry) => [entry.file.id, entry.searchText])), [mediaIndex]);

  const folderTree = useMemo(() => buildFolderTree(scanPaths, scanFolders, mediaFiles), [scanPaths, scanFolders, mediaFiles]);
  const allFolderPaths = useMemo(() => collectNodePaths(folderTree), [folderTree]);
  const allFolderPathSet = useMemo(() => new Set(allFolderPaths), [allFolderPaths]);
  const selectedFolderSet = useMemo(() => new Set(selectedFolderPaths), [selectedFolderPaths]);
  const activeFolderFilterCount = allFolderPaths.length
    ? selectedFolderPaths.filter((path: string) => allFolderPathSet.has(path)).length
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

      if (libraryTableResizeRef.current) {
        const delta = libraryTableResizeRef.current.startY - event.clientY;
        const nextHeight = Math.min(640, Math.max(160, libraryTableResizeRef.current.startHeight + delta));
        setLibraryTableHeight(nextHeight);
        return;
      }

      if (scanTableResizeRef.current) {
        const delta = scanTableResizeRef.current.startY - event.clientY;
        const nextHeight = Math.min(640, Math.max(160, scanTableResizeRef.current.startHeight + delta));
        setScanTableHeight(nextHeight);
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
      libraryTableResizeRef.current = null;
      scanTableResizeRef.current = null;
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
    const query = deferredSearchText.trim().toLowerCase();
    const fromTime = deferredDateFromInput ? new Date(`${deferredDateFromInput}T00:00:00`).getTime() : null;
    const toTime = deferredDateToInput ? new Date(`${deferredDateToInput}T23:59:59`).getTime() : null;
    const filteredFiles: MediaFile[] = [];

    for (const entry of mediaIndex) {
      const file = entry.file;

      if (allFolderPaths.length && !selectedFolderSet.has(entry.folderPath)) {
        continue;
      }

      if (selectedTagFilterLower && !entry.normalizedTags.includes(selectedTagFilterLower)) {
        continue;
      }

      if (parsedTagFilters.length) {
        const hasMatch =
          tagMatchMode === "all"
            ? parsedTagFilters.every((tag) => entry.normalizedTags.includes(tag))
            : parsedTagFilters.some((tag) => entry.normalizedTags.includes(tag));
        if (!hasMatch) {
          continue;
        }
      }

      if (missingFilterMode === "only") {
        if (!file.missing) {
          continue;
        }
      } else if (missingFilterMode === "hide" && file.missing) {
        continue;
      }

      if (fromTime !== null || toTime !== null) {
        if (entry.takenTime === null) {
          continue;
        }
        if (fromTime !== null && entry.takenTime < fromTime) {
          continue;
        }
        if (toTime !== null && entry.takenTime > toTime) {
          continue;
        }
      }

      if (dateSourceFilter !== "all" && entry.normalizedDateSource !== dateSourceFilter) {
        continue;
      }

      if (parsedMinFileSizeMb !== null && file.fileSizeMb < parsedMinFileSizeMb) {
        continue;
      }

      if (parsedMaxFileSizeMb !== null && file.fileSizeMb > parsedMaxFileSizeMb) {
        continue;
      }

      if (parsedMinMegapixels !== null && (file.megapixels === null || file.megapixels < parsedMinMegapixels)) {
        continue;
      }

      if (parsedMaxMegapixels !== null && (file.megapixels === null || file.megapixels > parsedMaxMegapixels)) {
        continue;
      }

      if (mediaTypeFilter !== "all" && file.mediaType !== mediaTypeFilter) {
        continue;
      }

      if (extensionFilter !== "all" && entry.extensionLower !== extensionFilter) {
        continue;
      }

      if (query && !entry.searchText.includes(query)) {
        continue;
      }

      filteredFiles.push(file);
    }

    return filteredFiles;
  }, [
    allFolderPaths.length,
    dateSourceFilter,
    deferredDateFromInput,
    deferredDateToInput,
    deferredSearchText,
    extensionFilter,
    mediaIndex,
    mediaTypeFilter,
    missingFilterMode,
    parsedMaxFileSizeMb,
    parsedMaxMegapixels,
    parsedMinFileSizeMb,
    parsedMinMegapixels,
    parsedTagFilters,
    selectedFolderSet,
    selectedTagFilterLower,
    tagMatchMode
  ]);

  const previewMediaFiles = useMemo(() => visibleMediaFiles.slice(0, scanPreviewLimit), [visibleMediaFiles]);
  const duplicateSearchIndex = useMemo(
    () =>
      duplicateGroups.map((group) => ({
        group,
        searchText: group.items
          .map((item) => mediaSearchTextById.get(item.id) ?? [item.filename, item.extension, item.mediaType, item.path, item.scanRoot, item.tags.join(" ")].join(" ").toLowerCase())
          .join(" ")
      })),
    [duplicateGroups, mediaSearchTextById]
  );
  const filteredDuplicateGroups = useMemo(() => {
    const query = deferredSearchText.trim().toLowerCase();
    if (!query) {
      return duplicateGroups;
    }

    return duplicateSearchIndex
      .filter((entry) => entry.searchText.includes(query))
      .map((entry) => entry.group);
  }, [deferredSearchText, duplicateGroups, duplicateSearchIndex]);
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
  const gridMediaFiles = useMemo(() => (activeSection === "Library" ? libraryMediaFiles : visibleMediaFiles), [activeSection, libraryMediaFiles, visibleMediaFiles]);
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
    () => duplicateItems.filter((item) => selectedFileIdSet.has(item.id)),
    [duplicateItems, selectedFileIdSet]
  );
  const selectedDuplicateItemsGlobal = useMemo(() => {
    const seenIds = new Set<number>();
    const selectedItems: MediaFile[] = [];

    for (const group of duplicateGroups) {
      for (const item of group.items) {
        if (seenIds.has(item.id) || !selectedFileIdSet.has(item.id)) {
          continue;
        }
        seenIds.add(item.id);
        selectedItems.push(item);
      }
    }

    return selectedItems;
  }, [duplicateGroups, selectedFileIdSet]);
  const selectedDuplicateCount = useMemo(
    () => selectedDuplicateItems.length,
    [selectedDuplicateItems]
  );
  const selectedDuplicateBytes = useMemo(
    () => selectedDuplicateItems.reduce((total, item) => total + item.fileSizeBytes, 0),
    [selectedDuplicateItems]
  );
  const selectedDuplicateGlobalCount = useMemo(
    () => selectedDuplicateItemsGlobal.length,
    [selectedDuplicateItemsGlobal]
  );
  const selectedDuplicateGlobalBytes = useMemo(
    () => selectedDuplicateItemsGlobal.reduce((total, item) => total + item.fileSizeBytes, 0),
    [selectedDuplicateItemsGlobal]
  );
  const fullySelectedDuplicateGroups = useMemo(
    () =>
      duplicateGroups.filter((group) => group.items.length > 1 && group.items.every((item) => selectedFileIdSet.has(item.id))),
    [duplicateGroups, selectedFileIdSet]
  );
  const warmableNativePreviewFiles = useMemo(
    () =>
      mediaFiles.filter(
        (item) => !item.missing && scanPaths.includes(item.scanRoot) && canNativePreviewExtension(item.extension)
      ),
    [mediaFiles, scanPaths]
  );
  const selectedFolderFileIds = useMemo(() => {
    if (!allFolderPaths.length) {
      return [];
    }

    return mediaIndex
      .filter((entry) => !entry.file.missing && selectedFolderSet.has(entry.folderPath))
      .map((entry) => entry.file.id);
  }, [allFolderPaths.length, mediaIndex, selectedFolderSet]);
  const activeMediaItem = useMemo(
    () =>
      activeMediaCollection.find((item) => item.id === activeMediaId) ??
      activeMediaCollection.find((item) => selectedFileIdSet.has(item.id)) ??
      activeMediaCollection[0] ??
      null,
    [activeMediaCollection, activeMediaId, selectedFileIdSet]
  );
  const magnifiedMediaItem = useMemo(
    () => mediaFiles.find((item) => item.id === magnifiedMediaId) ?? null,
    [mediaFiles, magnifiedMediaId]
  );
  const activeDuplicateIsSelected = useMemo(
    () => Boolean(activeMediaItem && duplicateItemIds.includes(activeMediaItem.id) && selectedFileIdSet.has(activeMediaItem.id)),
    [activeMediaItem, duplicateItemIds, selectedFileIdSet]
  );

  const configuredRootCount = Math.max(scanPaths.length, scanRoots.length);
  const duplicateGroupCount = duplicateGroups.length;
  const duplicateFileCount = duplicateScanResult?.duplicateFiles ?? duplicateGroups.reduce((sum, group) => sum + group.fileCount, 0);
  const duplicateWasteMb =
    duplicateScanResult?.wastedSizeMb ?? duplicateGroups.reduce((sum, group) => sum + group.wastedSizeMb, 0);
  const isBusy = isScanning || isFindingDuplicates || isExecutingMoveCopy || isWarmingDuplicateHashes;
  const activeDuplicateMode = duplicateScanResult?.matchMode ?? duplicateMatchMode;
  const duplicateReviewReadOnly = activeDuplicateMode === "probable";
  const scanDiscoveredProgressRatio = useMemo(() => {
    if (!scanProgress || !scanProgress.supportedFilesSeen) {
      return null;
    }

    return Math.max(0, Math.min(1, scanProgress.scannedFiles / Math.max(scanProgress.supportedFilesSeen, 1)));
  }, [scanProgress]);
  const selectedFiles = useMemo(
    () => mediaFiles.filter((item) => selectedFileIdSet.has(item.id)),
    [mediaFiles, selectedFileIdSet]
  );
  const moveSelectedFolderSet = useMemo(() => new Set(moveSelectedFolderPaths), [moveSelectedFolderPaths]);
  const moveSourceFiles = useMemo(() => {
    switch (moveScope) {
      case "selected":
        return selectedFiles;
      case "folders":
        return mediaIndex
          .filter((entry) => moveSelectedFolderSet.has(entry.folderPath))
          .map((entry) => entry.file);
      default:
        return mediaFiles;
    }
  }, [mediaFiles, mediaIndex, moveScope, moveSelectedFolderSet, selectedFiles]);
  const moveEligibleFiles = useMemo(
    () => moveSourceFiles.filter((item) => !item.missing),
    [moveSourceFiles]
  );
  const moveSourcePreviewFiles = useMemo(
    () => moveEligibleFiles.slice(0, scanPreviewLimit),
    [moveEligibleFiles]
  );
  const renderSelectableMediaCard = (item: MediaFile) => (
    <article
      className={`media-card ${item.missing ? "missing" : ""} ${
        selectedFileIdSet.has(item.id) ? "selected" : ""
      } ${activeMediaItem?.id === item.id ? "active-item" : ""}`}
      onClick={() => activateMediaFile(item.id)}
      onDoubleClick={() => {
        if (activeSection === "Library" && !item.missing) {
          setMagnifiedMediaId(item.id);
        }
      }}
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
          checked={selectedFileIdSet.has(item.id)}
          onChange={() => toggleFileSelection(item.id)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${item.filename}`}
        />
        <PreviewImage item={item} />
        <span>{item.extension.toUpperCase()}</span>
      </div>
    </article>
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
    if (magnifiedMediaId !== null && !magnifiedMediaItem) {
      setMagnifiedMediaId(null);
    }
  }, [magnifiedMediaId, magnifiedMediaItem]);

  useEffect(() => {
    if (!magnifiedMediaItem) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMagnifiedMediaId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [magnifiedMediaItem]);

  useEffect(() => {
    if (!filteredDuplicateGroups.length) {
      setActiveDuplicateGroupKey(null);
      return;
    }

    if (!activeDuplicateGroup) {
      setActiveDuplicateGroupKey(filteredDuplicateGroups[0].key);
    }
  }, [activeDuplicateGroup, filteredDuplicateGroups]);

  useEffect(() => {
    if (
      !activeMediaItem ||
      activeMediaItem.missing ||
      activeMediaItem.mediaType === "video" ||
      imageMetadataHydrationAttempts.has(activeMediaItem.id) ||
      (
        activeMediaItem.width !== null &&
        activeMediaItem.height !== null &&
        activeMediaItem.cameraMake !== null &&
        activeMediaItem.cameraModel !== null &&
        activeMediaItem.dateSource?.toLowerCase().includes("metadata")
      )
    ) {
      return;
    }

    let cancelled = false;
    imageMetadataHydrationAttempts.add(activeMediaItem.id);

    void invoke<MediaFile>("hydrate_media_dimensions", { fileId: activeMediaItem.id })
      .then((hydratedFile) => {
        if (cancelled) {
          return;
        }
        setMediaFiles((current) =>
          current.map((file) => (file.id === hydratedFile.id ? hydratedFile : file))
        );
      })
      .catch((error) => {
        if (!cancelled) {
          imageMetadataHydrationAttempts.delete(activeMediaItem.id);
          console.warn("Failed to hydrate image dimensions", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeMediaItem?.id,
    activeMediaItem?.path,
    activeMediaItem?.mediaType,
    activeMediaItem?.width,
    activeMediaItem?.height,
    activeMediaItem?.missing
  ]);

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

  function beginLibraryTableResize(clientY: number) {
    libraryTableResizeRef.current = {
      startY: clientY,
      startHeight: libraryTableHeight
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  function beginScanTableResize(clientY: number) {
    scanTableResizeRef.current = {
      startY: clientY,
      startHeight: scanTableHeight
    };
    document.body.style.cursor = "row-resize";
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
    const confirmed = window.confirm(
      `Remove ${path} from the saved library and future scans?\n\nThis will remove its cached files and folders from the app.`
    );

    if (!confirmed) {
      return;
    }

    void (async () => {
      try {
        await invoke("remove_scan_root", { path });
        const [files, roots, folders, savedTags, history] = await Promise.all([
          invoke<MediaFile[]>("list_media"),
          invoke<ScanRoot[]>("list_scan_roots"),
          invoke<ScanFolder[]>("list_scan_folders"),
          invoke<TagSummary[]>("list_tags"),
          invoke<OperationHistoryEntry[]>("list_operation_history")
        ]);
        const nextScanPaths = scanPaths.filter((currentPath) => currentPath !== path);
        setMediaFiles(files);
        setScanRoots(roots);
        setScanFolders(folders);
        setTags(savedTags);
        setOperationHistory(history);
        setScanPaths(nextScanPaths);
        setSelectedFileIds((currentIds) =>
          currentIds.filter((id) => files.some((file) => file.id === id))
        );
        const nextTree = buildFolderTree(nextScanPaths, folders, files);
        const nextKnownPaths = collectNodePaths(nextTree);
        setSelectedFolderPaths((currentPaths) =>
          mergeKnownPaths(
            currentPaths.filter((currentPath) => currentPath !== path),
            nextKnownPaths
          )
        );
        setExpandedFolderPaths((currentPaths) =>
          currentPaths.filter((currentPath) => currentPath !== path && nextKnownPaths.includes(currentPath))
        );
        setMoveSelectedFolderPaths((currentPaths) =>
          currentPaths.filter((currentPath) => currentPath !== path && nextKnownPaths.includes(currentPath))
        );
        setMoveExpandedFolderPaths((currentPaths) =>
          currentPaths.filter((currentPath) => currentPath !== path && nextKnownPaths.includes(currentPath))
        );
        setStatus(`Removed ${path} from the saved library`);
      } catch (error) {
        setStatus(`Failed to remove ${path}: ${String(error)}`);
      }
    })();
  }

  async function runScan(forceRescan = false) {
    if (!scanPaths.length) {
      setStatus("Add at least one folder or drive path before scanning");
      return;
    }

    cancelPreviewWarmup();
    setIsScanning(true);
    setScanProgress(null);
    const startedAtUnix = Math.floor(Date.now() / 1000);
    setStatus(forceRescan ? "Running full scan across selected paths..." : "Refreshing selected paths for new, changed, or missing files...");
    try {
      const result = await invoke<ScanResponse>("scan_media", {
        request: { paths: scanPaths, extensions: selectedExtensions, forceRescan }
      });
      const executedAtUnix = Math.floor(Date.now() / 1000);
      const files = await invoke<MediaFile[]>("list_media");
      const roots = await invoke<ScanRoot[]>("list_scan_roots");
      const folders = await invoke<ScanFolder[]>("list_scan_folders");
      const savedTags = await invoke<TagSummary[]>("list_tags");
      const history = await invoke<OperationHistoryEntry[]>("list_operation_history");
      setScanResult(result);
      setLastScanExecutionReport({
        mode: forceRescan ? "full" : "refresh",
        startedAtUnix,
        executedAtUnix,
        durationSeconds: Math.max(0, executedAtUnix - startedAtUnix),
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

    const scanScopeFiles = mediaFiles.filter((item) => lastScanExecutionReport.paths.includes(item.scanRoot));
    const scanScopeMediaFiles = scanScopeFiles.filter((item) => !item.missing);
    const extensionBreakdown = [...scanScopeMediaFiles.reduce((map, item) => {
      const key = item.extension.toUpperCase();
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>()).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const rootSummaries = lastScanExecutionReport.paths.map((rootPath) => {
      const filesForRoot = scanScopeFiles.filter((item) => item.scanRoot === rootPath);
      const mediaForRoot = filesForRoot.filter((item) => !item.missing);
      const foldersForRoot = scanFolders.filter((folder) => folder.scanRoot === rootPath && !folder.missing && folder.path !== rootPath);
      return {
        rootPath,
        folderCount: foldersForRoot.length,
        mediaCount: mediaForRoot.length,
        missingCount: filesForRoot.filter((item) => item.missing).length
      };
    });

    const summaryLines = [
      ["Scan start", formatDateTime(lastScanExecutionReport.startedAtUnix)],
      ["Scan end", formatDateTime(lastScanExecutionReport.executedAtUnix)],
      ["Duration", formatDuration(lastScanExecutionReport.durationSeconds)],
      ["Scan mode", lastScanExecutionReport.mode === "full" ? "Full scan" : "Refresh scan"],
      ["Selected paths", `${lastScanExecutionReport.paths.length}`],
      ["Selected file types", `${lastScanExecutionReport.extensions.length}`],
      ["Total files seen", `${lastScanExecutionReport.result.totalFilesSeen}`],
      ["Supported media files seen", `${lastScanExecutionReport.result.supportedFilesSeen}`],
      ["Folders visited (including root)", `${lastScanExecutionReport.result.foldersVisited}`],
      ["Processed files", `${lastScanExecutionReport.result.scannedFiles}`],
      ["Cached files", `${lastScanExecutionReport.result.cachedFiles}`],
      ["Unchanged files", `${lastScanExecutionReport.result.skippedUnchanged}`],
      ["Missing files", `${lastScanExecutionReport.result.missingFiles}`],
      ["Current media records in scope", `${scanScopeMediaFiles.length}`],
      ["Warnings / errors", `${lastScanExecutionReport.result.errors.length}`]
    ];

    const csvLines = [
      ...summaryLines.map((line) => line.map((value) => csvEscape(value)).join(",")),
      "",
      ["Scan paths"].map(csvEscape).join(","),
      ...lastScanExecutionReport.paths.map((path) => csvEscape(path)),
      "",
      ["Enabled extensions"].map(csvEscape).join(","),
      lastScanExecutionReport.extensions.map((extension) => csvEscape(`.${extension}`)).join(","),
      "",
      ["Scan root summary"].map(csvEscape).join(","),
      ["Root Path", "Folders (excluding root)", "Media Records", "Missing Records"]
        .map(csvEscape)
        .join(","),
      ...rootSummaries.map((row) =>
        [row.rootPath, row.folderCount, row.mediaCount, row.missingCount]
          .map((value) => csvEscape(String(value)))
          .join(",")
      ),
      "",
      ["File type breakdown"].map(csvEscape).join(","),
      ["Extension", "Count"]
        .map(csvEscape)
        .join(","),
      ...extensionBreakdown.map(([extension, count]) =>
        [extension, count].map((value) => csvEscape(String(value))).join(",")
      ),
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

  async function warmNativePreviews() {
    if (previewWarmProgress?.running) {
      setStatus("Native preview warm-up is already running in the background");
      return;
    }

    if (!warmableNativePreviewFiles.length) {
      setStatus("No native-preview image files are available for warm-up in the selected scan roots");
      return;
    }

    const runId = previewWarmRunRef.current + 1;
    previewWarmRunRef.current = runId;
    const total = warmableNativePreviewFiles.length;
    setPreviewWarmProgress({
      total,
      processed: 0,
      available: 0,
      failed: 0,
      currentFilename: null,
      running: true
    });
    setStatus(`Warming native previews for ${total.toLocaleString()} file(s) in the background...`);

    let processed = 0;
    let available = 0;
    let failed = 0;

    try {
      for (const item of warmableNativePreviewFiles) {
        if (previewWarmRunRef.current !== runId) {
          return;
        }

        await waitForNativePreviewQueueIdle();
        await waitForMainThreadIdle();

        const previewSrc = await loadNativeImagePreview(item.path);
        if (previewWarmRunRef.current !== runId) {
          return;
        }

        processed += 1;
        if (previewSrc) {
          available += 1;
        } else {
          failed += 1;
        }

        if (processed % 5 === 0 || processed === total) {
          setPreviewWarmProgress({
            total,
            processed,
            available,
            failed,
            currentFilename: processed < total ? item.filename : null,
            running: processed < total
          });
        }

        await sleep(40);
      }

      setPreviewWarmProgress({
        total,
        processed,
        available,
        failed,
        currentFilename: null,
        running: false
      });
      setStatus(
        `Native preview warm-up complete: ${available.toLocaleString()} ready, ${failed.toLocaleString()} unavailable`
      );
    } catch (error) {
      setPreviewWarmProgress({
        total,
        processed,
        available,
        failed,
        currentFilename: null,
        running: false
      });
      setStatus(`Native preview warm-up failed: ${String(error)}`);
    }
  }

  useEffect(() => {
    if (isBusy) {
      cancelPreviewWarmup();
    }
  }, [isBusy]);

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

  async function openAppDataLocation() {
    if (!appSettings?.appDataDir) {
      setStatus("App data path is not available yet");
      return;
    }

    try {
      await invoke("open_file_location", { path: appSettings.appDataDir });
      setStatus("Opened app data location");
    } catch (error) {
      setStatus(`Open app data location failed: ${String(error)}`);
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

  function cancelPreviewWarmup() {
    if (!previewWarmProgress?.running) {
      return;
    }

    previewWarmRunRef.current += 1;
    setPreviewWarmProgress((current) =>
      current
        ? {
            ...current,
            running: false,
            currentFilename: null
          }
        : current
    );
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

    cancelPreviewWarmup();
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
    cancelPreviewWarmup();
    setDuplicateScanProgress(null);
    setIsFindingDuplicates(true);
    setStatus(
      duplicateMatchMode === "exact"
        ? "Checking for exact duplicates..."
        : "Reviewing likely duplicates by filename, size, and timing..."
    );
    try {
      const result = await invoke<DuplicateScanResponse>(
        duplicateMatchMode === "exact" ? "find_duplicates" : "find_probable_duplicates"
      );
      setDuplicateGroups(result.groups);
      setDuplicateScanResult(result);
      setActiveDuplicateGroupKey(result.groups[0]?.key ?? null);
      setSelectedFileIds([]);
      setDuplicateCleanupConfirmed(false);
      const [files, savedTags] = await Promise.all([
        invoke<MediaFile[]>("list_media"),
        invoke<TagSummary[]>("list_tags"),
        refreshOperationHistory()
      ]).then(([nextFiles, nextTags]) => [nextFiles, nextTags] as const);
      setMediaFiles(files);
      setTags(savedTags);
      const skippedSuffix = result.skippedInaccessibleFiles
        ? `, skipped ${result.skippedInaccessibleFiles.toLocaleString()} inaccessible cached file(s)`
        : "";
      setStatus(
        result.groups.length
          ? `${
              duplicateMatchMode === "exact" ? "Found" : "Reviewed"
            } ${result.groups.length.toLocaleString()} ${
              duplicateMatchMode === "exact" ? "duplicate" : "probable duplicate"
            } groups across ${result.duplicateFiles.toLocaleString()} files${skippedSuffix}`
          : duplicateMatchMode === "exact"
            ? `No exact duplicates found${skippedSuffix}`
            : `No probable duplicate groups found${skippedSuffix}`
      );
    } catch (error) {
      setStatus(
        `${duplicateMatchMode === "exact" ? "Exact" : "Probable"} duplicate check failed: ${String(error)}`
      );
    } finally {
      setIsFindingDuplicates(false);
    }
  }

  async function warmDuplicateHashes() {
    cancelPreviewWarmup();
    setDuplicateScanProgress(null);
    setIsWarmingDuplicateHashes(true);
    setStatus("Preparing duplicate hash warm-up...");
    try {
      const result = await invoke<DuplicateHashWarmResponse>("warm_duplicate_hashes");
      await refreshOperationHistory();
      const skippedSuffix = result.skippedInaccessibleFiles
        ? `, skipped ${result.skippedInaccessibleFiles.toLocaleString()} inaccessible cached file(s)`
        : "";
      setStatus(
        result.candidates
          ? `Duplicate hash warm-up finished: ${result.hashedFiles.toLocaleString()} hashed across ${result.candidates.toLocaleString()} candidate file(s)${skippedSuffix}`
          : "Duplicate hash warm-up found no pending candidates"
      );
    } catch (error) {
      setStatus(`Duplicate hash warm-up failed: ${String(error)}`);
    } finally {
      setIsWarmingDuplicateHashes(false);
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

  function collectDuplicateCleanupPaths() {
    const selectedPaths = selectedDuplicateItemsGlobal.map((item) => item.path);

    if (!selectedPaths.length) {
      setStatus("Select one or more duplicate files first");
      return null;
    }

    return selectedPaths;
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
    const duplicateSelectionIds = selectedDuplicateItemsGlobal.map((item) => item.id);

    if (!duplicateSelectionIds.length) {
      setStatus("Select one or more duplicate files first");
      return;
    }

    setSelectedFileIds(duplicateSelectionIds);
    setMoveScope("selected");
    setActiveSection("Move/Copy");
    setStatus(`Sent ${duplicateSelectionIds.length.toLocaleString()} duplicate file(s) to Move/Copy`);
  }

  async function runDuplicateCleanup(mode: DuplicateCleanupMode) {
    const selectedPaths = collectDuplicateCleanupPaths();
    if (!selectedPaths) {
      return;
    }

    if (mode === "move" && !duplicateCleanupDestination.trim()) {
      setStatus("Choose a cleanup folder before moving duplicate files");
      return;
    }

    if (mode === "move" && !duplicateCleanupConfirmed) {
      setStatus("Confirm duplicate move before running cleanup");
      return;
    }

    const selectedPathSet = new Set(selectedPaths);
    const activeSelectionWillBeCleaned = activeMediaItem ? selectedPathSet.has(activeMediaItem.path) : false;
    if (activeSelectionWillBeCleaned) {
      setActiveMediaId(null);
      setMagnifiedMediaId(null);
      await sleep(120);
    }

    setIsCleaningDuplicates(true);
    setStatus(
      mode === "delete"
        ? `Deleting ${selectedPaths.length.toLocaleString()} duplicate file(s)...`
        : `Moving ${selectedPaths.length.toLocaleString()} duplicate file(s) to cleanup folder...`
    );

    try {
      const result = await invoke<CleanupDuplicatesResponse>("cleanup_duplicates", {
        request: {
          mode,
          collisionPolicy: duplicateCleanupCollisionPolicy,
          destinationFolder: mode === "move" ? duplicateCleanupDestination : null,
          paths: selectedPaths
        }
      });

      await initializeAppData();
      const refreshedDuplicates = await invoke<DuplicateScanResponse>(
        duplicateMatchMode === "probable" ? "find_probable_duplicates" : "find_duplicates"
      );
      setDuplicateGroups(refreshedDuplicates.groups);
      setDuplicateScanResult(refreshedDuplicates);
      setActiveDuplicateGroupKey(refreshedDuplicates.groups[0]?.key ?? null);
      setSelectedFileIds([]);
      setDuplicateCleanupConfirmed(false);
      setDeleteDuplicateConfirmOpen(false);
      setSkipDeleteWarningDraft(false);

      if (mode === "delete") {
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

  function requestDeleteSelectedDuplicates() {
    const selectedPaths = collectDuplicateCleanupPaths();
    if (!selectedPaths) {
      return;
    }

    if (skipDeleteWarningThisSession) {
      void runDuplicateCleanup("delete");
      return;
    }

    setSkipDeleteWarningDraft(false);
    setDeleteDuplicateConfirmOpen(true);
  }

  function confirmDeleteSelectedDuplicates() {
    if (skipDeleteWarningDraft) {
      setSkipDeleteWarningThisSession(true);
    }
    void runDuplicateCleanup("delete");
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
      const refreshedDuplicates = await invoke<DuplicateScanResponse>(
        duplicateScanResult.matchMode === "probable" ? "find_probable_duplicates" : "find_duplicates"
      );
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
                    ? duplicateMatchMode === "exact"
                      ? "Find exact duplicate files, review each group, and compare paths before any cleanup work."
                      : "Review likely duplicates grouped by filename, size, and timing heuristics."
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
              <button className="secondary-button" onClick={openAppDataLocation} disabled={!appSettings}>
                <FolderOpen size={17} />
                Open app data
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
            {activeSection === "Duplicates" ? (
              <button
                className="secondary-button"
                onClick={warmDuplicateHashes}
                disabled={isBusy || duplicateMatchMode !== "exact"}
                title={duplicateMatchMode === "exact" ? undefined : "Hash warm-up is only used for exact duplicate checks."}
              >
                <Hash size={17} />
                {isWarmingDuplicateHashes ? "Warming hashes" : "Warm hashes"}
              </button>
            ) : null}
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
                  : duplicateMatchMode === "exact"
                    ? "Find exact"
                    : "Find probable"
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
                    <strong>About MediaTagger</strong>
                    <div className="settings-path-list">
                      <label>
                        <span>Version</span>
                        <div>{appSettings?.appVersion || "Loading..."}</div>
                      </label>
                      <label>
                        <span>App identifier</span>
                        <div>{appSettings?.appIdentifier || "Loading..."}</div>
                      </label>
                    </div>
                  </div>

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
                    <div className="detail-actions">
                      <button onClick={openAppDataLocation} disabled={!appSettings}>
                        <FolderOpen size={16} />
                        Open app data location
                      </button>
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
                      <VirtualMediaGrid
                        items={moveSourcePreviewFiles}
                        width={activeThumbnailDimensions.width}
                        height={activeThumbnailDimensions.height}
                        className="move-source-grid"
                        emptyMessage="No source files are currently available for preview."
                        getItemKey={(item) => `move-preview-${item.path}`}
                        renderItem={(item) => renderSelectableMediaCard(item)}
                      />
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

                <VirtualDataGrid
                  labels={["Name", "Action", "Source", "Destination"]}
                  columnSet="move"
                  columnWidths={gridColumnWidths.move}
                  items={movePreviewItems}
                  rowClassName="move-preview-row"
                  emptyMessage="No preview built yet. Choose a destination and click Build preview."
                  getRowKey={(item) => `${item.id}-${item.destinationPath}`}
                  renderCells={(item) => [
                    <span key="name">{item.filename}</span>,
                    <span key="action">{item.reason}</span>,
                    <span key="source">{item.sourcePath}</span>,
                    <span key="destination">{item.destinationPath}</span>
                  ]}
                  onBeginResize={beginGridColumnResize}
                />
              </section>
            </>
          ) : null}
          {activeSection === "Duplicates" ? (
            <>
              <section className="panel tree-panel duplicate-groups-panel">
                <div className="panel-header">
                  <div>
                    <h2>Duplicate Groups</h2>
                    <p>
                      {activeDuplicateMode === "exact"
                        ? "Exact matches are grouped by content hash so you can review path-by-path before cleanup."
                        : "Likely duplicates are grouped by same-name, size, and timing heuristics for manual review."}
                    </p>
                  </div>
                  <Hash size={20} />
                </div>
                <div className="panel-note">
                  <strong>{filteredDuplicateGroups.length.toLocaleString()} groups in view</strong>
                  <span>
                    {duplicateFileCount.toLocaleString()} {activeDuplicateMode === "exact" ? "duplicate" : "probable duplicate"} files found so far
                  </span>
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
                      {duplicateScanResult
                        ? `No ${activeDuplicateMode === "exact" ? "duplicate" : "probable duplicate"} groups match the current search.`
                        : `Run Find ${duplicateMatchMode === "exact" ? "exact" : "probable"} to build the review list.`}
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
                        ? `Compare ${activeDuplicateGroup.fileCount} ${
                            activeDuplicateMode === "exact" ? "exact matches" : "likely matches"
                          } before deciding what to keep.`
                        : `Select a ${activeDuplicateMode === "exact" ? "duplicate" : "probable duplicate"} group to review its matching files.`}
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

                <div className="planner-toggle duplicate-mode-toggle">
                  <button
                    className={duplicateMatchMode === "exact" ? "active" : ""}
                    onClick={() => {
                      setDuplicateMatchMode("exact");
                      setDuplicateGroups([]);
                      setDuplicateScanResult(null);
                      setActiveDuplicateGroupKey(null);
                      setSelectedFileIds([]);
                    }}
                    disabled={isFindingDuplicates || isCleaningDuplicates}
                  >
                    Exact
                  </button>
                  <button
                    className={duplicateMatchMode === "probable" ? "active" : ""}
                    onClick={() => {
                      setDuplicateMatchMode("probable");
                      setDuplicateGroups([]);
                      setDuplicateScanResult(null);
                      setActiveDuplicateGroupKey(null);
                      setSelectedFileIds([]);
                    }}
                    disabled={isFindingDuplicates || isCleaningDuplicates}
                  >
                    Probable
                  </button>
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
                  <button onClick={keepActiveDuplicate} disabled={duplicateReviewReadOnly || !duplicateItems.length || !activeMediaItem}>
                    Keep active
                  </button>
                  <button onClick={keepActiveAndPrepareCleanup} disabled={duplicateReviewReadOnly || !duplicateItems.length || !activeMediaItem}>
                    Keep active, clean rest
                  </button>
                  <button onClick={sendDuplicateSelectionToMoveCopy} disabled={duplicateReviewReadOnly || !selectedDuplicateGlobalCount}>
                    <MoveRight size={16} />
                    Send to Move/Copy
                  </button>
                  <button onClick={requestDeleteSelectedDuplicates} disabled={duplicateReviewReadOnly || !selectedDuplicateGlobalCount || isCleaningDuplicates}>
                    <AlertCircle size={16} />
                    {isCleaningDuplicates ? "Running cleanup..." : "Delete selected duplicates"}
                  </button>
                  <button onClick={clearDuplicateGroupSelection} disabled={!selectedDuplicateCount}>
                    Clear group
                  </button>
                  <span className="duplicate-selection-note">
                    {selectedDuplicateGlobalCount.toLocaleString()} selected across duplicate groups
                  </span>
                </div>

                {duplicateReviewReadOnly ? (
                  <div className="panel-note duplicate-review-readonly">
                    <strong>Probable duplicates are review-only</strong>
                    <span>
                      This mode groups files by same-name, size, and timing heuristics. Cleanup actions stay disabled so the exact duplicate workflow remains the safe path for deletion.
                    </span>
                  </div>
                ) : null}

                {!duplicateReviewReadOnly ? (
                <div className={`planner-section duplicate-cleanup-panel ${duplicateMovePanelOpen ? "open" : "collapsed"}`}>
                  <button
                    className="collapse-row"
                    onClick={() => setDuplicateMovePanelOpen((current) => !current)}
                    aria-expanded={duplicateMovePanelOpen}
                  >
                    <strong>Move to cleanup folder</strong>
                    {duplicateMovePanelOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {!duplicateMovePanelOpen && selectedDuplicateGlobalCount ? (
                    <div className="duplicate-compact-preflight">
                      {selectedDuplicateGlobalCount.toLocaleString()} selected | {formatFileSize(selectedDuplicateGlobalBytes)} estimated
                    </div>
                  ) : null}
                  {duplicateMovePanelOpen && !duplicateReviewReadOnly ? (
                    <div className="duplicate-move-options">
                      <div className="panel-note duplicate-preflight-note">
                        <strong>Move preflight</strong>
                        <span>
                          {activeMediaItem && duplicateItemIds.includes(activeMediaItem.id)
                            ? `Active file: ${activeMediaItem.filename}`
                            : "No active duplicate item selected"}
                        </span>
                        <span>
                          {selectedDuplicateGlobalCount.toLocaleString()} cleanup item(s) selected
                          {selectedDuplicateGlobalCount ? ` | ${formatFileSize(selectedDuplicateGlobalBytes)} estimated` : ""}
                        </span>
                        <span>
                          {duplicateCleanupDestination
                            ? `Move selected files to ${duplicateCleanupDestination}`
                            : "Choose a cleanup folder to move selected files"}
                        </span>
                        {fullySelectedDuplicateGroups.length ? (
                          <span className="duplicate-preflight-warning">
                            {fullySelectedDuplicateGroups.length.toLocaleString()} duplicate group(s) have every copy selected.
                          </span>
                        ) : null}
                        {activeDuplicateIsSelected ? (
                          <span className="duplicate-preflight-warning">
                            The active file is included in the cleanup selection.
                          </span>
                        ) : null}
                      </div>
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
                      <label className="duplicate-confirmation">
                        <input
                          type="checkbox"
                          checked={duplicateCleanupConfirmed}
                          onChange={(event) => setDuplicateCleanupConfirmed(event.target.checked)}
                        />
                        <span>
                          I understand these selected duplicate files will be moved out of the current library view.
                        </span>
                      </label>

                      <div className="detail-actions">
                        <button onClick={() => void runDuplicateCleanup("move")} disabled={!selectedDuplicateGlobalCount || isCleaningDuplicates}>
                          <FolderOpen size={16} />
                          {isCleaningDuplicates ? "Running cleanup..." : "Move selected duplicates"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                ) : null}

                <div
                  className={`library-workbench duplicate-review-workbench ${detailPanelOpen ? "" : "details-collapsed"}`}
                  style={detailPanelOpen ? { gridTemplateColumns: `minmax(0, 1fr) 7px ${detailPanelWidth}px` } : undefined}
                >
                  <div className="library-main duplicate-review-main">
                    <div className="duplicate-group-summary">
                      <span>{activeDuplicateMode === "exact" ? "Hash" : "Heuristic"}</span>
                      <strong>{activeDuplicateGroup ? activeDuplicateGroup.hash.slice(0, 32) : "No group selected"}</strong>
                      {activeDuplicateGroup ? <small>{activeDuplicateGroup.hash}</small> : null}
                    </div>
                    <VirtualMediaGrid
                      items={duplicateItems}
                      width={activeThumbnailDimensions.width}
                      height={activeThumbnailDimensions.height}
                      className="library-grid duplicate-review-grid"
                      emptyMessage={
                        duplicateScanResult
                          ? "No files are currently selected for duplicate review."
                          : `Run Find ${duplicateMatchMode === "exact" ? "exact" : "probable"} to load match groups.`
                      }
                      getItemKey={(item) => `${activeDuplicateGroup?.key}-${item.path}`}
                      renderItem={(item) => renderSelectableMediaCard(item)}
                    />

                    <VirtualDataGrid
                      labels={["Select", "Name", "Type", "Size", "Date taken", "Path", "Tags"]}
                      columnSet="duplicate"
                      columnWidths={gridColumnWidths.duplicate}
                      items={duplicateItems}
                      rowClassName="duplicate-grid-row"
                      emptyMessage={
                        duplicateScanResult
                          ? "No files are currently selected for duplicate review."
                          : `Run Find ${duplicateMatchMode === "exact" ? "exact" : "probable"} to load match groups.`
                      }
                      getRowKey={(item) => `${item.path}-duplicate-row`}
                      getRowClassName={(item) => (selectedFileIdSet.has(item.id) ? "selected" : "")}
                      onRowClick={(item) => activateMediaFile(item.id)}
                      renderCells={(item) => [
                        <span key="select">
                          <input
                            type="checkbox"
                            checked={selectedFileIdSet.has(item.id)}
                            onChange={() => toggleFileSelection(item.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Select ${item.filename}`}
                          />
                        </span>,
                        <span key="name">{item.filename}</span>,
                        <span key="type">{item.extension.toUpperCase()}</span>,
                        <span key="size">{formatFileSize(item.fileSizeBytes)}</span>,
                        <span key="date">{formatDate(item.dateTakenUnix)}</span>,
                        <span key="path">{item.path}</span>,
                        <span key="tags">{item.tags.join(", ") || "No tags"}</span>
                      ]}
                      onBeginResize={beginGridColumnResize}
                    />
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
                          <LazyDetailPreview item={activeMediaItem} />
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
                              <strong>{formatFileSize(activeMediaItem.fileSizeBytes)}</strong>
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
                        {activeMediaItem.mediaType === "video" ? <VideoDetailRows item={activeMediaItem} /> : <ImageDetailRows item={activeMediaItem} />}
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
                <div className="scan-status-actions">
                  <button
                    onClick={() => void warmNativePreviews()}
                    disabled={isBusy || previewWarmProgress?.running || !warmableNativePreviewFiles.length}
                  >
                    <FileImage size={16} />
                    {previewWarmProgress?.running ? "Warming previews..." : "Warm previews"}
                  </button>
                </div>
                {scanProgress ? (
                  <div className="planner-section scan-progress-panel">
                    <div className="move-report-header">
                      <strong>Current scan progress</strong>
                      <span>{scanProgress.stage}</span>
                    </div>
                    <div className="progress-meter" aria-hidden="true">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.round((scanDiscoveredProgressRatio ?? 0) * 100)}%` }}
                      />
                    </div>
                    <div className="panel-note">
                      <strong>
                        {scanProgress.scannedFiles.toLocaleString()} of {scanProgress.supportedFilesSeen.toLocaleString()} discovered media processed
                      </strong>
                      <span>
                        {scanProgress.scanRoot ? `Root: ${scanProgress.scanRoot}` : "Waiting for scan root information"}
                      </span>
                      {scanProgress.currentPath ? <span className="scan-progress-path">{scanProgress.currentPath}</span> : null}
                    </div>
                    <div className="scan-progress-grid">
                      <span><strong>{scanProgress.foldersVisited.toLocaleString()}</strong> folders visited</span>
                      <span><strong>{scanProgress.totalFilesSeen.toLocaleString()}</strong> total files seen</span>
                      <span><strong>{scanProgress.supportedFilesSeen.toLocaleString()}</strong> media files seen</span>
                      <span><strong>{scanProgress.scannedFiles.toLocaleString()}</strong> processed</span>
                      <span><strong>{scanProgress.skippedUnchanged.toLocaleString()}</strong> unchanged</span>
                      <span><strong>{scanProgress.errorsCount.toLocaleString()}</strong> errors</span>
                    </div>
                  </div>
                ) : null}
                {lastScanExecutionReport ? (
                  <div className="planner-section move-report-section">
                    <div className="move-report-header">
                      <strong>Last scan report</strong>
                      <div className="move-report-header-actions">
                        <button onClick={() => void exportScanSummaryReport()}>
                          <Copy size={16} />
                          Export CSV
                        </button>
                      </div>
                    </div>
                    <div className="move-report-summary">
                      <span>start {formatDateTime(lastScanExecutionReport.startedAtUnix)}</span>
                      <span>{formatDateTime(lastScanExecutionReport.executedAtUnix)}</span>
                      <span>{formatDuration(lastScanExecutionReport.durationSeconds)}</span>
                      <span>{lastScanExecutionReport.mode === "full" ? "Full scan" : "Refresh scan"}</span>
                      <span>{lastScanExecutionReport.paths.length.toLocaleString()} paths</span>
                      <span>{lastScanExecutionReport.extensions.length.toLocaleString()} file types</span>
                      <span>{lastScanExecutionReport.result.totalFilesSeen.toLocaleString()} total files seen</span>
                      <span>{lastScanExecutionReport.result.supportedFilesSeen.toLocaleString()} media files seen</span>
                      <span>{lastScanExecutionReport.result.scannedFiles.toLocaleString()} processed</span>
                      <span>{lastScanExecutionReport.result.missingFiles.toLocaleString()} missing</span>
                    </div>
                    {previewWarmProgress ? (
                      <div className="warm-preview-summary">
                        <span>
                          {previewWarmProgress.running ? "Background preview warm-up" : "Last preview warm-up"}:
                          {" "}
                          {previewWarmProgress.processed.toLocaleString()}/{previewWarmProgress.total.toLocaleString()} processed
                        </span>
                        <span>{previewWarmProgress.available.toLocaleString()} ready</span>
                        {previewWarmProgress.failed ? <span>{previewWarmProgress.failed.toLocaleString()} unavailable</span> : null}
                        {previewWarmProgress.currentFilename ? <span>{previewWarmProgress.currentFilename}</span> : null}
                      </div>
                    ) : null}
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
                    <VirtualMediaGrid
                      items={activePreviewFiles}
                      width={activeThumbnailDimensions.width}
                      height={activeThumbnailDimensions.height}
                      className={`thumb-size-${thumbnailSize} ${activeSection === "Library" ? "library-grid" : "scan-grid"}`}
                      emptyMessage="No media files found yet. Add a path and start a scan."
                      getItemKey={(item) => item.path}
                      renderItem={(item) => renderSelectableMediaCard(item)}
                    />
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
                      <button onClick={() => setLibraryTableOpen((current) => !current)}>
                        {libraryTableOpen ? "Hide file list" : "Show file list"}
                      </button>
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

                {activeSection !== "Library" || libraryTableOpen ? (
                  <>
                    {activeSection === "Library" ? (
                      <div
                        className="library-table-resize-rail"
                        aria-label="Resize file list panel"
                        onMouseDown={(event) => beginLibraryTableResize(event.clientY)}
                      />
                    ) : activeSection === "Scan" ? (
                      <div
                        className="scan-table-resize-rail"
                        aria-label="Resize scan file list panel"
                        onMouseDown={(event) => beginScanTableResize(event.clientY)}
                      />
                    ) : null}
                    <div
                      className={
                        activeSection === "Library"
                          ? "library-table-shell"
                          : activeSection === "Scan"
                            ? "scan-table-shell"
                            : undefined
                      }
                      style={
                        activeSection === "Library"
                          ? { height: `${libraryTableHeight}px` }
                          : activeSection === "Scan"
                            ? { height: `${scanTableHeight}px` }
                            : undefined
                      }
                    >
                      <VirtualDataGrid
                        labels={["Select", "Name", "Type", "Size", "Date taken", "Path"]}
                        columnSet="media"
                        columnWidths={gridColumnWidths.media}
                        items={gridMediaFiles}
                        emptyMessage="No media files found yet. Add a path and start a scan."
                        getRowKey={(item) => `${item.path}-row`}
                        getRowClassName={(item) => (selectedFileIdSet.has(item.id) ? "selected" : "")}
                        onRowClick={(item) => activateMediaFile(item.id)}
                        renderCells={(item) => [
                          <span key="select">
                            <input
                              type="checkbox"
                              checked={selectedFileIdSet.has(item.id)}
                              onChange={() => toggleFileSelection(item.id)}
                              onClick={(event) => event.stopPropagation()}
                              aria-label={`Select ${item.filename}`}
                            />
                          </span>,
                          <span key="name">{item.filename}</span>,
                          <span key="type">{item.extension.toUpperCase()}</span>,
                        <span key="size">{formatFileSize(item.fileSizeBytes)}</span>,
                          <span key="date">{formatDate(item.dateTakenUnix)}</span>,
                          <span key="path">{item.path}</span>
                        ]}
                        onBeginResize={beginGridColumnResize}
                      />
                    </div>
                  </>
                ) : null}
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
                      <LazyDetailPreview item={activeMediaItem} />
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
                          <strong>{formatFileSize(activeMediaItem.fileSizeBytes)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><Grid3X3 size={14} /> Dimensions</span>
                          <strong>{formatDimensions(activeMediaItem)}</strong>
                        </div>
                        <div className="detail-row">
                          <span><Grid3X3 size={14} /> Megapixels</span>
                          <strong>{activeMediaItem.megapixels !== null ? `${activeMediaItem.megapixels} MP` : "Unknown"}</strong>
                        </div>
                        {activeMediaItem.mediaType === "video" ? <VideoDetailRows item={activeMediaItem} /> : <ImageDetailRows item={activeMediaItem} />}
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
            <strong title={status}>{status}</strong>
          </div>
          <div className="status-details">
            <span>
              {activeSection === "Duplicates"
                ? `${duplicateFileCount.toLocaleString()} duplicate files`
                : `${visibleMediaFiles.length.toLocaleString()} media in view`}
            </span>
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
        {magnifiedMediaItem ? (
          <div className="magnify-overlay" onClick={() => setMagnifiedMediaId(null)}>
            <div className="magnify-dialog" onClick={(event) => event.stopPropagation()}>
              <div className="magnify-header">
                <div>
                  <strong>{magnifiedMediaItem.filename}</strong>
                  <span>{magnifiedMediaItem.path}</span>
                </div>
                <button onClick={() => setMagnifiedMediaId(null)}>Close</button>
              </div>
              <div className="detail-preview magnify-preview">
                <DetailPreview item={magnifiedMediaItem} />
              </div>
            </div>
          </div>
        ) : null}
        {deleteDuplicateConfirmOpen ? (
          <div className="magnify-overlay" onClick={() => setDeleteDuplicateConfirmOpen(false)}>
            <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
              <div className="confirm-dialog-header">
                <strong>Delete selected duplicates?</strong>
                <span>
                  This will permanently remove the selected duplicate files from disk and mark them missing in the local scan cache.
                </span>
                {fullySelectedDuplicateGroups.length ? (
                  <span className="duplicate-preflight-warning">
                    Every copy is selected in {fullySelectedDuplicateGroups.length.toLocaleString()} duplicate group(s).
                  </span>
                ) : null}
              </div>
              <label className="duplicate-confirmation">
                <input
                  type="checkbox"
                  checked={skipDeleteWarningDraft}
                  onChange={(event) => setSkipDeleteWarningDraft(event.target.checked)}
                />
                <span>Do not show this warning again during this session.</span>
              </label>
              <div className="confirm-dialog-actions">
                <button onClick={() => setDeleteDuplicateConfirmOpen(false)}>Cancel</button>
                <button onClick={confirmDeleteSelectedDuplicates}>Delete</button>
              </div>
            </div>
          </div>
        ) : null}
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

  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }

  if (bytes >= 1024) {
    return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
  }

  return `${bytes.toLocaleString()} B`;
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

function formatScanProgressStatus(progress: ScanProgress) {
  const parts = [
    `${progress.stage}`,
    `${progress.foldersVisited.toLocaleString()} folders`,
    `${progress.totalFilesSeen.toLocaleString()} total files seen`,
    `${progress.supportedFilesSeen.toLocaleString()} media files seen`,
    `${progress.scannedFiles.toLocaleString()} processed`,
    `${progress.skippedUnchanged.toLocaleString()} unchanged`
  ];
  if (progress.errorsCount) {
    parts.push(`${progress.errorsCount.toLocaleString()} errors`);
  }
  if (progress.scanRoot) {
    parts.push(`root: ${progress.scanRoot}`);
  }
  return parts.join(" | ");
}

function formatDuplicateProgressStatus(progress: DuplicateScanProgress) {
  const parts = [
    progress.stage,
    `${progress.candidates.toLocaleString()} candidates`,
    `${progress.processed.toLocaleString()} processed`,
    `${progress.groupsFound.toLocaleString()} groups`,
    `${progress.hashedFiles.toLocaleString()} hashed`
  ];
  if (progress.currentPath) {
    parts.push(`path: ${progress.currentPath}`);
  }
  return parts.join(" | ");
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForMainThreadIdle() {
  const requestIdle = (window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
  }).requestIdleCallback;

  if (requestIdle) {
    await new Promise<void>((resolve) => {
      requestIdle(() => resolve(), { timeout: 180 });
    });
    return;
  }

  await sleep(80);
}

async function waitForNativePreviewQueueIdle() {
  while (
    nativeImagePreviewQueue.active > 0 ||
    nativeImagePreviewQueue.pending.length > 0 ||
    nativeImagePreviewInflight.size > 0
  ) {
    await sleep(120);
  }
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

function runQueuedTask<T>(queue: LimitedQueue, task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      queue.active += 1;
      void task()
        .then(resolve, reject)
        .finally(() => {
          queue.active -= 1;
          const next = queue.pending.shift();
          if (next) {
            next();
          }
        });
    };

    if (queue.active < queue.limit) {
      run();
    } else {
      queue.pending.push(run);
    }
  });
}

function loadVideoMetadata(path: string): Promise<VideoMetadataResult> {
  const cached = videoMetadataCache.get(path);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inflight = videoMetadataInflight.get(path);
  if (inflight) {
    return inflight;
  }

  const metadataPromise = runQueuedTask(videoMetadataQueue, () =>
    new Promise<VideoMetadataResult>((resolve) => {
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
        const metadata = {
          durationSeconds: Number.isFinite(video.duration) ? video.duration : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          durationLabel: null,
          bitrateLabel: null,
          codec: null
        };
        void invoke<{ durationLabel: string | null; bitrateLabel: string | null; codec: string | null }>(
          "read_video_metadata_details",
          { path }
        )
          .then((details) => ({
            ...metadata,
            durationLabel: details.durationLabel,
            bitrateLabel: details.bitrateLabel,
            codec: details.codec
          }))
          .catch(() => metadata)
          .then((combined) => {
            videoMetadataCache.set(path, combined);
            cleanup();
            resolve(combined);
          });
      };

      const fail = () => {
        const metadata = {
          durationSeconds: null,
          width: null,
          height: null,
          durationLabel: null,
          bitrateLabel: null,
          codec: null
        };
        videoMetadataCache.set(path, metadata);
        cleanup();
        resolve(metadata);
      };

      video.addEventListener("loadedmetadata", finish, { once: true });
      video.addEventListener("error", fail, { once: true });
      video.src = convertFileSrc(path);
    })
  );

  videoMetadataInflight.set(path, metadataPromise);
  void metadataPromise.finally(() => videoMetadataInflight.delete(path));
  return metadataPromise;
}

function loadVideoThumbnail(path: string): Promise<string | null> {
  if (videoThumbnailCache.has(path)) {
    return Promise.resolve(videoThumbnailCache.get(path) ?? null);
  }

  const inflight = videoThumbnailInflight.get(path);
  if (inflight) {
    return inflight;
  }

  const thumbnailPromise = runQueuedTask(videoThumbnailQueue, () =>
    new Promise<string | null>((resolve) => {
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

      const fail = () => {
        videoThumbnailCache.set(path, null);
        cleanup();
        resolve(null);
      };

      const captureFrame = () => {
        const width = video.videoWidth || 320;
        const height = video.videoHeight || 180;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");

        if (!context) {
          fail();
          return;
        }

        context.fillStyle = "#f8f7f3";
        context.fillRect(0, 0, width, height);
        context.drawImage(video, 0, 0, width, height);
        const thumbnail = canvas.toDataURL("image/jpeg", 0.82);
        videoThumbnailCache.set(path, thumbnail);
        cleanup();
        resolve(thumbnail);
      };

      video.addEventListener("error", fail, { once: true });
      video.addEventListener(
        "loadeddata",
        () => {
          const seekTarget = Number.isFinite(video.duration) && video.duration > 0.25 ? 0.25 : 0;
          if (seekTarget > 0) {
            video.addEventListener("seeked", captureFrame, { once: true });
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

      video.src = convertFileSrc(path);
    })
  );

  videoThumbnailInflight.set(path, thumbnailPromise);
  void thumbnailPromise.finally(() => videoThumbnailInflight.delete(path));
  return thumbnailPromise;
}

function canNativePreviewExtension(extension: string) {
  return ["heic", "heif", "cr2", "nef"].includes(extension.toLowerCase());
}

function loadNativeImagePreview(path: string): Promise<string | null> {
  if (nativeImagePreviewCache.has(path)) {
    return Promise.resolve(nativeImagePreviewCache.get(path) ?? null);
  }

  const inflight = nativeImagePreviewInflight.get(path);
  if (inflight) {
    return inflight;
  }

  const previewPromise = runQueuedTask(nativeImagePreviewQueue, async () => {
    try {
      const previewPath = await invoke<string | null>("generate_native_image_preview", {
        path,
        maxDimension: 512
      });
      const previewSrc = previewPath ? convertFileSrc(previewPath) : null;
      nativeImagePreviewCache.set(path, previewSrc);
      return previewSrc;
    } catch {
      nativeImagePreviewCache.set(path, null);
      return null;
    }
  });

  nativeImagePreviewInflight.set(path, previewPromise);
  void previewPromise.finally(() => nativeImagePreviewInflight.delete(path));
  return previewPromise;
}

const PreviewImage = memo(function PreviewImage({ item }: { item: MediaFile }) {
  const [failed, setFailed] = useState(false);
  const [nativePreviewSrc, setNativePreviewSrc] = useState<string | null>(null);
  const canPreview = !item.missing && canPreviewExtension(item.extension);
  const needsNativePreview = !item.missing && canNativePreviewExtension(item.extension);

  useEffect(() => {
    let canceled = false;

    if (!needsNativePreview) {
      setNativePreviewSrc(null);
      return;
    }

    setFailed(false);
    setNativePreviewSrc(nativeImagePreviewCache.get(item.path) ?? null);
    void loadNativeImagePreview(item.path).then((previewSrc) => {
      if (!canceled) {
        setNativePreviewSrc(previewSrc);
      }
    });

    return () => {
      canceled = true;
    };
  }, [item.path, needsNativePreview]);

  if (item.mediaType === "video" && canVideoPreviewExtension(item.extension)) {
    return <VideoThumbnail item={item} />;
  }

  if (needsNativePreview && nativePreviewSrc && !failed) {
    return <img src={nativePreviewSrc} alt="" onError={() => setFailed(true)} loading="lazy" />;
  }

  if (!canPreview || failed) {
    return <FileImage size={34} />;
  }

  return <img src={convertFileSrc(item.path)} alt="" onError={() => setFailed(true)} loading="lazy" />;
});

const DetailPreview = memo(function DetailPreview({ item }: { item: MediaFile }) {
  const [failed, setFailed] = useState(false);
  const [nativePreviewSrc, setNativePreviewSrc] = useState<string | null>(null);
  const needsNativePreview = !item.missing && canNativePreviewExtension(item.extension);

  useEffect(() => {
    let canceled = false;

    if (!needsNativePreview) {
      setNativePreviewSrc(null);
      return;
    }

    setFailed(false);
    setNativePreviewSrc(nativeImagePreviewCache.get(item.path) ?? null);
    void loadNativeImagePreview(item.path).then((previewSrc) => {
      if (!canceled) {
        setNativePreviewSrc(previewSrc);
      }
    });

    return () => {
      canceled = true;
    };
  }, [item.path, needsNativePreview]);

  if (item.missing) {
    return <FileImage size={56} />;
  }

  if (item.mediaType === "video" && canVideoPreviewExtension(item.extension)) {
    return <video src={convertFileSrc(item.path)} controls muted preload="metadata" onError={() => setFailed(true)} />;
  }

  if (needsNativePreview && nativePreviewSrc && !failed) {
    return <img src={nativePreviewSrc} alt="" onError={() => setFailed(true)} loading="lazy" />;
  }

  if (canPreviewExtension(item.extension) && !failed) {
    return <img src={convertFileSrc(item.path)} alt="" onError={() => setFailed(true)} loading="lazy" />;
  }

  return item.mediaType === "video" ? <Film size={56} /> : <FileImage size={56} />;
});

const LazyDetailPreview = memo(function LazyDetailPreview({ item }: { item: MediaFile }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    let canceled = false;
    let timer: number | null = null;
    let observer: IntersectionObserver | null = null;

    const scheduleReady = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        if (!canceled) {
          setReady(true);
        }
      }, 120);
    };

    const element = containerRef.current;
    if (element && "IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          scheduleReady();
          observer?.disconnect();
        }
      });
      observer.observe(element);
    } else {
      scheduleReady();
    }

    return () => {
      canceled = true;
      observer?.disconnect();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [item.id, item.path]);

  return (
    <div className="detail-preview" ref={containerRef}>
      {ready ? (
        <DetailPreview item={item} />
      ) : item.mediaType === "video" ? (
        <div className="detail-preview-placeholder">
          <Film size={48} />
          <span>Loading preview...</span>
        </div>
      ) : (
        <div className="detail-preview-placeholder">
          <FileImage size={48} />
          <span>Loading preview...</span>
        </div>
      )}
    </div>
  );
});

const VideoThumbnail = memo(function VideoThumbnail({ item }: { item: MediaFile }) {
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (item.missing || !canVideoPreviewExtension(item.extension)) {
      setThumbnailSrc(null);
      setFailed(false);
      return;
    }

    let canceled = false;
    setFailed(false);
    setThumbnailSrc(videoThumbnailCache.get(item.path) ?? null);
    void loadVideoThumbnail(item.path).then((thumbnail) => {
      if (canceled) {
        return;
      }

      if (thumbnail) {
        setThumbnailSrc(thumbnail);
      } else {
        setFailed(true);
      }
    });

    return () => {
      canceled = true;
    };
  }, [item.extension, item.missing, item.path]);

  if (failed) {
    return <Film size={34} />;
  }

  if (thumbnailSrc) {
    return <img src={thumbnailSrc} alt="" className="video-thumb-image" loading="lazy" />;
  }

  return <div className="video-thumb-placeholder"><Film size={30} /></div>;
});

function VideoDetailRows({ item }: { item: MediaFile }) {
  const metadata = useVideoMetadata(item);

  return (
    <>
      <div className="detail-row">
        <span><Film size={14} /> Duration</span>
        <strong>
          {metadata.durationLabel ??
            (metadata.durationSeconds !== null ? formatDuration(metadata.durationSeconds) : "Loading duration...")}
        </strong>
      </div>
      <div className="detail-row">
        <span><Grid3X3 size={14} /> Video frame</span>
        <strong>
          {metadata.width && metadata.height
            ? `${metadata.width} x ${metadata.height}`
            : "Loading frame size..."}
        </strong>
      </div>
      <div className="detail-row">
        <span><HardDrive size={14} /> Video codec</span>
        <strong>{metadata.codec ?? "Loading codec..."}</strong>
      </div>
      <div className="detail-row">
        <span><HardDrive size={14} /> Bit rate</span>
        <strong>{metadata.bitrateLabel ?? "Loading bitrate..."}</strong>
      </div>
    </>
  );
}

function ImageDetailRows({ item }: { item: MediaFile }) {
  return (
    <>
      <div className="detail-row">
        <span><HardDrive size={14} /> Camera make</span>
        <strong>{item.cameraMake ?? "Unknown"}</strong>
      </div>
      <div className="detail-row">
        <span><HardDrive size={14} /> Camera model</span>
        <strong>{item.cameraModel ?? "Unknown"}</strong>
      </div>
      <div className="detail-row">
        <span><HardDrive size={14} /> Lens</span>
        <strong>{item.lensModel ?? "Unknown"}</strong>
      </div>
      <div className="detail-row">
        <span><Grid3X3 size={14} /> Aperture</span>
        <strong>{item.aperture ?? "Unknown"}</strong>
      </div>
      <div className="detail-row">
        <span><Grid3X3 size={14} /> Focal length</span>
        <strong>{item.focalLength ?? "Unknown"}</strong>
      </div>
      <div className="detail-row">
        <span><Grid3X3 size={14} /> ISO</span>
        <strong>{item.isoValue ?? "Unknown"}</strong>
      </div>
    </>
  );
}

function useVideoMetadata(item: MediaFile | null) {
  const [metadata, setMetadata] = useState<VideoMetadataResult>({
    durationSeconds: null,
    width: null,
    height: null,
    durationLabel: null,
    bitrateLabel: null,
    codec: null
  });

  useEffect(() => {
    if (!item || item.missing || item.mediaType !== "video" || !canVideoPreviewExtension(item.extension)) {
      setMetadata({
        durationSeconds: null,
        width: null,
        height: null,
        durationLabel: null,
        bitrateLabel: null,
        codec: null
      });
      return;
    }

    let canceled = false;
    setMetadata(
      videoMetadataCache.get(item.path) ?? {
        durationSeconds: null,
        width: null,
        height: null,
        durationLabel: null,
        bitrateLabel: null,
        codec: null
      }
    );
    void loadVideoMetadata(item.path).then((nextMetadata) => {
      if (!canceled) {
        setMetadata(nextMetadata);
      }
    });

    return () => {
      canceled = true;
    };
  }, [item?.extension, item?.mediaType, item?.missing, item?.path]);

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
  const nodeByPath = new Map<string, FolderNode>();
  const rootNodes = scanPaths.map((rootPath) => {
    const root: FolderNode = {
      label: folderLabel(rootPath),
      path: rootPath,
      count: 0,
      children: []
    };
    nodeByPath.set(normalizePathKey(rootPath), root);
    return root;
  });

  for (const rootPath of scanPaths) {
    const foldersForRoot = scanFolders
      .filter((folder) => folder.scanRoot === rootPath)
      .map((folder) => folder.path)
      .filter((folderPath) => folderPath !== rootPath)
      .sort((left, right) => pathDepth(left) - pathDepth(right));

    for (const folderPath of foldersForRoot) {
      const relative = relativePath(rootPath, folderPath);
      const folderParts = relative.split(/[\\/]/).filter(Boolean);
      let current = nodeByPath.get(normalizePathKey(rootPath));
      if (!current) {
        continue;
      }
      let currentPath = rootPath;

      for (const folderPart of folderParts) {
        currentPath = joinDisplayPath(currentPath, folderPart);
        const normalizedCurrentPath = normalizePathKey(currentPath);
        let child = nodeByPath.get(normalizedCurrentPath);
        if (!child) {
          child = {
            label: folderPart,
            path: currentPath,
            count: 0,
            children: []
          };
          nodeByPath.set(normalizedCurrentPath, child);
          current.children.push(child);
        }
        current = child;
      }
    }
  }

  for (const file of mediaFiles) {
    if (file.missing) {
      continue;
    }

    const rootPath = scanPaths.find((path) => isPathInside(file.path, path));
    if (!rootPath) {
      continue;
    }

    let currentPath = fileFolderPath(file.path);
    const rootKey = normalizePathKey(rootPath);

    while (currentPath) {
      const node = nodeByPath.get(normalizePathKey(currentPath));
      if (node) {
        node.count += 1;
      }

      if (normalizePathKey(currentPath) === rootKey) {
        break;
      }

      const nextPath = parentFolderPath(currentPath);
      if (!nextPath || nextPath === currentPath) {
        break;
      }
      currentPath = nextPath;
    }
  }

  rootNodes.forEach(sortFolderTree);
  return rootNodes;
}

function sortFolderTree(node: FolderNode) {
  node.children.sort((left, right) => left.label.localeCompare(right.label));
  node.children.forEach(sortFolderTree);
}

function collectNodePaths(nodes: FolderNode[]): string[] {
  return nodes.flatMap((node) => [node.path ?? node.label, ...collectNodePaths(node.children)]);
}

function mergeKnownPaths(currentPaths: string[], knownPaths: string[]) {
  const knownPathSet = new Set(knownPaths);
  const filtered = currentPaths.filter((path) => knownPathSet.has(path));
  const filteredSet = new Set(filtered);
  const additions = knownPaths.filter((path) => !filteredSet.has(path));
  return [...filtered, ...additions];
}

function isPathInside(filePath: string, folderPath: string) {
  const normalizedFilePath = normalizePathKey(filePath);
  const normalizedFolderPath = normalizePathKey(folderPath);
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

function parentFolderPath(folderPath: string) {
  const trimmedPath = folderPath.replace(/[\\/]+$/, "");
  const separator = trimmedPath.includes("\\") ? "\\" : "/";
  const parts = trimmedPath.split(/[\\/]/);
  if (parts.length <= 1) {
    return "";
  }
  parts.pop();
  const parent = parts.join(separator);
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}${separator}`;
  }
  return parent;
}

function joinDisplayPath(parent: string, child: string) {
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function normalizePathKey(path: string) {
  return path.replace(/[\\/]+$/, "").toLowerCase();
}

function pathDepth(path: string) {
  return path.split(/[\\/]/).filter(Boolean).length;
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
