import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns,
  Command,
  Copy,
  Crop,
  Download,
  Edit3,
  Eye,
  FileCheck,
  FilePlus,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Link as LinkIcon,
  Lock,
  Maximize2,
  MessageSquare,
  Moon,
  Move,
  Paperclip,
  PenTool,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  ScanText,
  Scissors,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Split,
  Square,
  Stamp,
  Sun,
  Trash2,
  Type,
  Undo2,
  Redo2,
  Upload,
  Wrench,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { checkBackendHealth, getApiBaseUrl, getDesktopBackendStatus, initApiBaseUrl, pdfApi } from './api';
import {
  AnnotationItem,
  AttachmentItem,
  BookmarkItem,
  ComparisonReport,
  DocumentSummary,
  EditorMode,
  FontItem,
  FormFieldCandidate,
  FormFieldItem,
  FormFillWarning,
  FormInspectionReport,
  ImageObject,
  LeftSidebarTab,
  PageObjectsData,
  ParagraphOverflowInfo,
  PreflightReport,
  SignatureVerificationReport,
  TextBoxDefaults,
  TextBlockObject,
  TextRun,
  TextSpanObject,
  ThumbnailItem,
  VellumBoxObject,
  VellumShapeObject,
} from './types';
import {
  applyStyleToRange,
  getDomSelectionOffsets,
  getSelectionStyle,
  mapPdfFontToCss,
  parseDomToRuns,
  replaceTextPreservingRuns,
  serializeRunsToDom,
  setDomSelectionOffsets,
} from './richTextUtils';
import vellumAppIcon from './assets/branding/vellum-app-icon.png';

type SubTool =
  | 'select'
  | 'edit-paragraph'
  | 'add-text'
  | 'add-image'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'shape-line'
  | 'shape-arrow'
  | 'add-link'
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'sticky_note'
  | 'freetext'
  | 'ink'
  | 'stamp'
  | 'form-text'
  | 'form-multiline'
  | 'form-checkbox'
  | 'form-radio'
  | 'form-dropdown'
  | 'form-listbox'
  | 'form-signature'
  | 'sig-visual'
  | 'sig-crypto'
  | 'redact-box';

const TEXTBOX_DEFAULTS_STORAGE_KEY = 'vellum.textbox.defaults.v1';
const FACTORY_TEXTBOX_DEFAULTS: TextBoxDefaults = {
  color: '#000000',
  font: 'helv',
  size: 11,
  align: 'left',
  bg_hex: 'transparent',
  border_hex: 'transparent',
};

function loadTextBoxDefaults(): TextBoxDefaults {
  try {
    const raw = window.localStorage.getItem(TEXTBOX_DEFAULTS_STORAGE_KEY);
    if (!raw) return { ...FACTORY_TEXTBOX_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      color: typeof parsed.color === 'string' ? parsed.color : FACTORY_TEXTBOX_DEFAULTS.color,
      font: typeof parsed.font === 'string' ? parsed.font : FACTORY_TEXTBOX_DEFAULTS.font,
      size: typeof parsed.size === 'number' && parsed.size >= 6 ? parsed.size : FACTORY_TEXTBOX_DEFAULTS.size,
      align: ['left', 'center', 'right', 'justify'].includes(parsed.align)
        ? parsed.align
        : FACTORY_TEXTBOX_DEFAULTS.align,
      bg_hex: typeof parsed.bg_hex === 'string' ? parsed.bg_hex : FACTORY_TEXTBOX_DEFAULTS.bg_hex,
      border_hex: typeof parsed.border_hex === 'string' ? parsed.border_hex : FACTORY_TEXTBOX_DEFAULTS.border_hex,
    };
  } catch {
    return { ...FACTORY_TEXTBOX_DEFAULTS };
  }
}

interface DraftTextBoxState {
  bbox: [number, number, number, number];
  text: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  bg_hex?: string;
  border_hex?: string;
  editingExistingId?: string;
}

interface DraftParagraphState {
  blockId: string;
  origBbox: [number, number, number, number];
  targetBbox: [number, number, number, number];
  expectedOrigText: string;
  text: string;
  runs: TextRun[];
  selectionRange: { start: number; end: number };
  font: string;
  originalFont: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  isMixedStyle: boolean;
  hasSubsetFont: boolean;
  overflowInfo: ParagraphOverflowInfo | null;
}

export interface ActiveTransformState {
  objectId: string;
  objectType: 'textbox' | 'shape' | 'image' | 'text_span';
  data: any;
  currentBbox: [number, number, number, number];
  origBbox: [number, number, number, number];
}

export interface DragGesture {
  type: 'move' | 'resize';
  handle?: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
  startMousePdf: [number, number];
  startBbox: [number, number, number, number];
  currentBbox: [number, number, number, number];
}

const VellumMarkIcon: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 256 256"
    className={className}
    style={{ display: 'block', flexShrink: 0 }}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="vellumBlueBlade" x1="0" x2="1" y1="1" y2="0">
        <stop offset="0" stopColor="#0063F4" />
        <stop offset="1" stopColor="#11A1FF" />
      </linearGradient>
      <linearGradient id="vellumNavyBlade" x1="0" x2="1" y1="0" y2="1">
        <stop stopColor="#0B3B7E" />
        <stop offset="1" stopColor="#061A43" />
      </linearGradient>
      <linearGradient id="vellumPaperWhite" x1="0" x2="0" y1="0" y2="1">
        <stop stopColor="#FFFFFF" />
        <stop offset="1" stopColor="#EAF1FE" />
      </linearGradient>
    </defs>
    {/* Page rising from the arms of the V */}
    <path d="M111 18 H180 L222 60 V133 L163 205 L112 155Z" fill="url(#vellumPaperWhite)" />
    <path d="M180 18 L180 60 L222 60 Z" fill="#0575FF" />
    <path d="M180 18 L180 60 L222 60" fill="none" stroke="#D3E4FF" strokeWidth="1.4" />
    <path d="M133 79 H174 M133 98 H183 M133 117 H166" stroke="#8294AF" strokeWidth="8" strokeLinecap="round" />
    {/* Left and right blades */}
    <path d="M14 28 H72 Q84 28 91 39 L135 131 L117 239 Z" fill="url(#vellumNavyBlade)" />
    <path d="M117 239 L211 73 L239 91 L163 228 Q157 239 145 239 Z" fill="url(#vellumBlueBlade)" />
    <path d="M211 73 L239 91 L222 60 Z" fill="#0379FE" />
  </svg>
);

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [engineReady, setEngineReady] = useState<boolean>(false);
  const [engineState, setEngineState] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [connectionAttempt, setConnectionAttempt] = useState<number>(1);
  const [backendErrorDetail, setBackendErrorDetail] = useState<string | null>(null);
  const [backendLogs, setBackendLogs] = useState<string[]>([]);
  const [showBackendDiag, setShowBackendDiag] = useState<boolean>(false);
  const [openDocs, setOpenDocs] = useState<DocumentSummary[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState<number>(0);
  const [zoom, setZoom] = useState<number>(1.15);

  const [mode, setMode] = useState<EditorMode>('edit');
  const [subTool, setSubTool] = useState<SubTool>('select');
  const [leftOpen, setLeftOpen] = useState<boolean>(true);
  const [leftTab, setLeftTab] = useState<LeftSidebarTab>('thumbnails');
  const [rightOpen, setRightOpen] = useState<boolean>(true);

  // Page render & extracted objects
  const [pageBitmap, setPageBitmap] = useState<string>('');
  const [pageSizePt, setPageSizePt] = useState<{ width: number; height: number }>({ width: 595, height: 842 });
  const [thumbnails, setThumbnails] = useState<ThumbnailItem[]>([]);
  const [pageObjects, setPageObjects] = useState<PageObjectsData | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [formFields, setFormFields] = useState<FormFieldItem[]>([]);
  const [formDraftValues, setFormDraftValues] = useState<Record<string, any>>({});
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [fontsList, setFontsList] = useState<FontItem[]>([]);
  const [sigVerification, setSigVerification] = useState<SignatureVerificationReport | null>(null);
  const [preflightReport, setPreflightReport] = useState<PreflightReport | null>(null);
  const [comparisonReport, setComparisonReport] = useState<ComparisonReport | null>(null);
  const [extractedTables, setExtractedTables] = useState<{ tables: any[]; csv_text: string } | null>(null);
  const [recoveryList, setRecoveryList] = useState<any[]>([]);

  // Active selection states
  const [selectedSpan, setSelectedSpan] = useState<TextSpanObject | null>(null);
  const [selectedImage, setSelectedImage] = useState<ImageObject | null>(null);
  const [selectedAnnot, setSelectedAnnot] = useState<AnnotationItem | null>(null);
  const [selectedField, setSelectedField] = useState<FormFieldItem | null>(null);

  // Unified Object Selection, Transformation, and Clipboard state
  const [selectedObj, setSelectedObj] = useState<ActiveTransformState | null>(null);
  const [activeGesture, setActiveGesture] = useState<DragGesture | null>(null);
  const [clipboardObj, setClipboardObj] = useState<ActiveTransformState | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x?: number; y?: number }>({});
  const [editShapeStrokeWidth, setEditShapeStrokeWidth] = useState<number>(2.0);
  const [editShapeOpacity, setEditShapeOpacity] = useState<number>(1.0);

  // Direct Text Span Editor state
  const [editSpanText, setEditSpanText] = useState<string>('');
  const [editSpanFont, setEditSpanFont] = useState<string>('helv');
  const [editSpanSize, setEditSpanSize] = useState<number>(12);
  const [editSpanColor, setEditSpanColor] = useState<string>('#000000');
  const [editSpanBold, setEditSpanBold] = useState<boolean>(false);
  const [editSpanItalic, setEditSpanItalic] = useState<boolean>(false);
  const [editSpanAlign, setEditSpanAlign] = useState<string>('left');
  const [editSpanBbox, setEditSpanBbox] = useState<[number, number, number, number]>([0, 0, 0, 0]);

  // Selected Image Transform state
  const [editImgBbox, setEditImgBbox] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [editImgRotation, setEditImgRotation] = useState<number>(0);
  const [editImgCrop, setEditImgCrop] = useState<[number, number, number, number]>([0, 0, 1, 1]);

  // Tool configuration states
  const [toolColor, setToolColor] = useState<string>('#2563eb');
  const [toolFillColor, setToolFillColor] = useState<string>('#eff6ff');
  const [toolFontSize, setToolFontSize] = useState<number>(13);
  const [toolFontName, setToolFontName] = useState<string>('helv');
  const [toolAuthor, setToolAuthor] = useState<string>('Linux Editor');
  const [toolStampName, setToolStampName] = useState<string>('APPROVED');
  const [toolCommentText, setToolCommentText] = useState<string>('Review note');
  const [newBookmarkTitle, setNewBookmarkTitle] = useState<string>('');

  // Form Designer & Fill config
  const [newFieldName, setNewFieldName] = useState<string>('custom_field_1');
  const [newFieldDefault, setNewFieldDefault] = useState<string>('');
  const [newFieldChoices, setNewFieldChoices] = useState<string>('Option A, Option B, Option C');
  const [newFieldRequired, setNewFieldRequired] = useState<boolean>(false);
  const [newFieldReadOnly, setNewFieldReadOnly] = useState<boolean>(false);
  const [newFieldMultiline, setNewFieldMultiline] = useState<boolean>(false);
  const [newFieldMaxLen, setNewFieldMaxLen] = useState<number>(0);
  const [newFieldAlign, setNewFieldAlign] = useState<'left' | 'center' | 'right'>('left');
  const [formInspection, setFormInspection] = useState<FormInspectionReport | null>(null);
  const [formCandidates, setFormCandidates] = useState<FormFieldCandidate[]>([]);
  const [formFillWarnings, setFormFillWarnings] = useState<FormFillWarning[]>([]);
  const [formAutoFit, setFormAutoFit] = useState<boolean>(true);
  const [formSubMode, setFormSubMode] = useState<'fill' | 'prepare'>('fill');
  const formWidgetRefs = useRef<Record<number, HTMLElement | null>>({});

  // Persistent Text Box Defaults (Black, Helvetica 11pt, Left, Transparent BG, No Border)
  const [textBoxDefaults, setTextBoxDefaults] = useState<TextBoxDefaults>(() => loadTextBoxDefaults());

  // Signature config
  const [signerName, setSignerName] = useState<string>('Alice Vance');
  const [signerOrg, setSignerOrg] = useState<string>('Vellum Linux Enterprise');
  const [signReason, setSignReason] = useState<string>('I approve and certify this document');
  const [signLocation, setSignLocation] = useState<string>('Linux Workstation');
  const [certPassphrase, setCertPassphrase] = useState<string>('vellum-secret');
  const [generatedP12B64, setGeneratedP12B64] = useState<string | null>(null);

  // OCR config
  const [ocrLang, setOcrLang] = useState<string>('eng');
  const [ocrDpi, setOcrDpi] = useState<number>(180);
  const [ocrForce, setOcrForce] = useState<boolean>(true);

  // Security & Redaction config
  const [redactSearchTerms, setRedactSearchTerms] = useState<string>('999-42-8174, ACCT-7781920');
  const [redactRegex, setRedactRegex] = useState<string>('');
  const [ redactOverlayLabel, setRedactOverlayLabel] = useState<string>('REDACTED');
  const [encUserPwd, setEncUserPwd] = useState<string>('');
  const [encOwnerPwd, setEncOwnerPwd] = useState<string>('');
  const [encAllowPrint, setEncAllowPrint] = useState<boolean>(true);
  const [encAllowModify, setEncAllowModify] = useState<boolean>(false);
  const [encAllowExtract, setEncAllowExtract] = useState<boolean>(false);

  // Page Ops & Pro features config
  const [cropMarginTop, setCropMarginTop] = useState<number>(24);
  const [cropMarginBottom, setCropMarginBottom] = useState<number>(24);
  const [cropMarginLeft, setCropMarginLeft] = useState<number>(24);
  const [cropMarginRight, setCropMarginRight] = useState<number>(24);
  const [splitRangeSpec, setSplitRangeSpec] = useState<string>('1; 2-3');
  const [watermarkText, setWatermarkText] = useState<string>('CONFIDENTIAL');
  const [watermarkOpacity, setWatermarkOpacity] = useState<number>(0.25);
  const [watermarkRotation, setWatermarkRotation] = useState<number>(45);
  const [headerCenter, setHeaderCenter] = useState<string>('{title}');
  const [footerCenter, setFooterCenter] = useState<string>('Page {page} of {total}');
  const [batesPrefix, setBatesPrefix] = useState<string>('BATES-');
  const [batesStart, setBatesStart] = useState<number>(1);
  const [compareTargetDocId, setCompareTargetDocId] = useState<string>('');

  // Search state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchMatches, setSearchMatches] = useState<
    Array<{ page_index: number; page_number: number; bbox: [number, number, number, number] }>
  >([]);

  // Rubberband & Freehand Drawing on Canvas
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);
  const [inkPoints, setInkPoints] = useState<Array<[number, number]>>([]);
  const [dragThumbIdx, setDragThumbIdx] = useState<number | null>(null);

  // UI Notifications, Menus & Modals
  const [statusBanner, setStatusBanner] = useState<{ text: string; kind: 'info' | 'warn' } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [paletteQuery, setPaletteQuery] = useState<string>('');
  const [showPropsModal, setShowPropsModal] = useState<boolean>(false);
  const [docPropsForm, setDocPropsForm] = useState<Record<string, string>>({});
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState<boolean>(false);

  // Active Inline Text Box state
  const [draftTextBox, setDraftTextBox] = useState<DraftTextBoxState | null>(null);
  const draftTextAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // Active Acrobat-style Paragraph Editor state
  const [draftParagraph, setDraftParagraph] = useState<DraftParagraphState | null>(null);
  const [isCommittingParagraph, setIsCommittingParagraph] = useState(false);
  const draftParagraphRef = useRef<HTMLDivElement | null>(null);

  // Active Hyperlink Creation Modal state
  const [linkDraftModal, setLinkDraftModal] = useState<{
    bbox: [number, number, number, number];
    uri: string;
  } | null>(null);

  // Password Unlock Modal state
  const [passwordPrompt, setPasswordPrompt] = useState<{
    filePath?: string;
    fileObj?: File;
    error?: string;
  } | null>(null);
  const [enteredPassword, setEnteredPassword] = useState<string>('');

  // Hidden file inputs for uploads
  const fileOpenInputRef = useRef<HTMLInputElement | null>(null);
  const imageInsertInputRef = useRef<HTMLInputElement | null>(null);
  const imageReplaceInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const insertPdfPagesInputRef = useRef<HTMLInputElement | null>(null);
  const docxConvertInputRef = useRef<HTMLInputElement | null>(null);
  const imagesConvertInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const activeDoc = useMemo(
    () => openDocs.find((d) => d.doc_id === activeDocId) || null,
    [openDocs, activeDocId]
  );

  const notify = useCallback((text: string, kind: 'info' | 'warn' = 'info') => {
    setStatusBanner({ text, kind });
  }, []);

  // Frameless Desktop Window state & handlers
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  useEffect(() => {
    if (window.vellumDesktop?.isWindowMaximized) {
      window.vellumDesktop.isWindowMaximized().then(setIsMaximized).catch(() => {});
    }
    if (window.vellumDesktop?.onWindowStateChange) {
      const cleanup = window.vellumDesktop.onWindowStateChange((state) => {
        setIsMaximized(state.isMaximized);
      });
      return cleanup;
    }
  }, []);

  const handleMinimizeWindow = useCallback(() => {
    if (window.vellumDesktop?.minimizeWindow) {
      window.vellumDesktop.minimizeWindow();
    }
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    if (window.vellumDesktop?.toggleMaximizeWindow) {
      const isMax = await window.vellumDesktop.toggleMaximizeWindow();
      setIsMaximized(isMax);
    }
  }, []);

  const handleCloseWindow = useCallback(() => {
    if (window.vellumDesktop?.closeWindow) {
      window.vellumDesktop.closeWindow();
    } else {
      window.close();
    }
  }, []);

  // Sync theme attribute on document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const saveTextBoxDefaults = useCallback(
    (next: TextBoxDefaults) => {
      setTextBoxDefaults(next);
      try {
        window.localStorage.setItem(TEXTBOX_DEFAULTS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage quota errors
      }
      notify('Saved default text box appearance preferences.');
    },
    [notify]
  );

  const resetTextBoxDefaults = useCallback(() => {
    const factory = { ...FACTORY_TEXTBOX_DEFAULTS };
    setTextBoxDefaults(factory);
    try {
      window.localStorage.setItem(TEXTBOX_DEFAULTS_STORAGE_KEY, JSON.stringify(factory));
    } catch {
      // ignore
    }
    notify('Reset text box defaults to Black (#000000), Helvetica 11pt, Left, Transparent.');
  }, [notify]);

  const refreshDocState = useCallback(
    async (docId: string, pageIdx: number, summaryOverride?: DocumentSummary) => {
      try {
        const summary = summaryOverride || (await pdfApi.getDocSummary(docId));
        setOpenDocs((prev) => {
          const exists = prev.some((d) => d.doc_id === docId);
          return exists ? prev.map((d) => (d.doc_id === docId ? summary : d)) : [...prev, summary];
        });

        const safePage = Math.max(0, Math.min(pageIdx, summary.page_count - 1));
        if (safePage !== pageIdx) setCurrentPage(safePage);

        const [renderRes, objsRes, annotsRes, inspectRes, thumbsRes, bmRes, attRes] = await Promise.all([
          pdfApi.renderPage(docId, safePage, Math.round(110 * Math.max(1, zoom))),
          pdfApi.getPageObjects(docId, safePage),
          pdfApi.listAnnotations(docId),
          pdfApi.inspectFormFields(docId),
          pdfApi.getThumbnails(docId, 52),
          pdfApi.getBookmarks(docId),
          pdfApi.listAttachments(docId),
        ]);

        const fieldsRes = inspectRes.fields || [];
        setPageBitmap(`data:image/png;base64,${renderRes.image_base64}`);
        setPageSizePt({ width: renderRes.width_pt, height: renderRes.height_pt });
        setPageObjects(objsRes);
        setAnnotations(annotsRes);
        setFormInspection(inspectRes);
        setFormFields(fieldsRes);
        const draftMap: Record<string, any> = {};
        fieldsRes.forEach((f) => {
          if (f.field_type === 'checkbox') {
            draftMap[f.field_name] = f.checked;
            draftMap[String(f.xref)] = f.checked;
          } else if (f.field_type === 'radiobutton') {
            draftMap[String(f.xref)] = f.checked;
            if (f.checked) {
              draftMap[f.field_name] = f.export_value || 'Yes';
            } else if (!(f.field_name in draftMap)) {
              draftMap[f.field_name] = '';
            }
          } else {
            draftMap[f.field_name] = f.value;
            draftMap[String(f.xref)] = f.value;
          }
        });
        setFormDraftValues(draftMap);
        setThumbnails(thumbsRes);
        setBookmarks(bmRes);
        setAttachments(attRes);
      } catch (err: any) {
        notify(`Error loading document state: ${err.message}`, 'warn');
      }
    },
    [zoom, notify]
  );

  // Initialize backend connection & open showcase document on startup with auto-retry
  const connectToBackend = useCallback(async (isManualRetry = false) => {
    setEngineState('connecting');
    setBackendErrorDetail(null);
    if (isManualRetry) {
      notify('Attempting to connect to Vellum backend...', 'info');
    }
    await initApiBaseUrl();

    const maxAttempts = 60; // 30 seconds total
    let healthy = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setConnectionAttempt(attempt);
      try {
        const ok = await checkBackendHealth(1200);
        if (ok) {
          healthy = true;
          break;
        }
      } catch {
        // continue polling
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    if (healthy) {
      setEngineReady(true);
      setEngineState('ready');
      setBackendErrorDetail(null);
      if (isManualRetry) {
        notify('Connected to Vellum engine!', 'info');
      }
      try {
        const existing = await pdfApi.listOpenDocs();
        if (existing.length > 0) {
          setOpenDocs(existing);
          setActiveDocId(existing[0].doc_id);
          await refreshDocState(existing[0].doc_id, 0, existing[0]);
        } else {
          const sample = await pdfApi.openSampleDoc();
          setOpenDocs([sample]);
          setActiveDocId(sample.doc_id);
          await refreshDocState(sample.doc_id, 0, sample);
        }
        const rec = await pdfApi.listRecovery();
        setRecoveryList(rec);
      } catch (docErr: any) {
        notify(`Failed to load initial document: ${docErr.message}`, 'warn');
      }
    } else {
      setEngineReady(false);
      setEngineState('error');
      const diag = await getDesktopBackendStatus();
      if (diag && diag.error) {
        setBackendErrorDetail(diag.error);
        if (diag.logs) setBackendLogs(diag.logs);
      } else {
        setBackendErrorDetail(`Unable to reach backend at ${getApiBaseUrl()}/api/health after ${maxAttempts} attempts.`);
      }
      notify('Backend connection could not be established. Click Retry in the status bar.', 'warn');
    }
  }, [notify, refreshDocState]);

  useEffect(() => {
    connectToBackend(false);
  }, [connectToBackend]);

  // Re-render current page when activeDocId, currentPage, or zoom changes
  useEffect(() => {
    if (activeDocId) {
      refreshDocState(activeDocId, currentPage);
    }
  }, [activeDocId, currentPage, zoom]);

  // Populate text span editor when a span is clicked
  useEffect(() => {
    if (selectedSpan) {
      setEditSpanText(selectedSpan.text);
      setEditSpanFont(selectedSpan.font);
      setEditSpanSize(selectedSpan.size);
      setEditSpanColor(selectedSpan.color);
      setEditSpanBold(selectedSpan.bold);
      setEditSpanItalic(selectedSpan.italic);
      setEditSpanAlign('left');
      setEditSpanBbox([...selectedSpan.bbox] as [number, number, number, number]);
      setRightOpen(true);
    }
  }, [selectedSpan]);

  // Populate image editor when an image is clicked
  useEffect(() => {
    if (selectedImage) {
      setEditImgBbox([...selectedImage.bbox] as [number, number, number, number]);
      setEditImgRotation(0);
      setEditImgCrop([0, 0, 1, 1]);
      setRightOpen(true);
    }
  }, [selectedImage]);

  // Actions
  const handleNewBlankDoc = async () => {
    const doc = await pdfApi.createNewDoc('Untitled_Document.pdf', 595, 842, 1);
    setOpenDocs((prev) => [...prev, doc]);
    setActiveDocId(doc.doc_id);
    setCurrentPage(0);
    notify('Created new blank A4 PDF document.');
  };

  const handleOpenSampleDoc = async () => {
    const doc = await pdfApi.openSampleDoc();
    setOpenDocs((prev) => [...prev, doc]);
    setActiveDocId(doc.doc_id);
    setCurrentPage(0);
    notify('Opened 3-page Vellum Enterprise MSA Showcase PDF.');
  };

  const handleNativeOrBrowserOpen = async () => {
    if (window.vellumDesktop?.openFileDialog) {
      const chosenPath = await window.vellumDesktop.openFileDialog();
      if (!chosenPath) return;
      try {
        const doc = await pdfApi.openByPath(chosenPath);
        setOpenDocs((prev) => [...prev, doc]);
        setActiveDocId(doc.doc_id);
        setCurrentPage(0);
        notify(`Opened ${doc.filename}`);
      } catch (err: any) {
        if (err.status === 401) {
          setPasswordPrompt({ filePath: chosenPath });
          setEnteredPassword('');
        } else {
          notify(`Open failed: ${err.message}`, 'warn');
        }
      }
    } else {
      fileOpenInputRef.current?.click();
    }
  };

  const handleBrowserFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const doc = await pdfApi.openUpload(file);
      setOpenDocs((prev) => [...prev, doc]);
      setActiveDocId(doc.doc_id);
      setCurrentPage(0);
      notify(`Opened ${doc.filename}`);
    } catch (err: any) {
      if (err.status === 401) {
        setPasswordPrompt({ fileObj: file });
        setEnteredPassword('');
      } else {
        notify(`Open failed: ${err.message}`, 'warn');
      }
    }
  };

  const handleUnlockEncryptedDoc = async () => {
    if (!passwordPrompt) return;
    try {
      let doc;
      if (passwordPrompt.filePath) {
        doc = await pdfApi.openByPath(passwordPrompt.filePath, enteredPassword);
      } else if (passwordPrompt.fileObj) {
        doc = await pdfApi.openUpload(passwordPrompt.fileObj, enteredPassword);
      }
      if (doc) {
        setOpenDocs((prev) => [...prev, doc]);
        setActiveDocId(doc.doc_id);
        setCurrentPage(0);
        setPasswordPrompt(null);
        setEnteredPassword('');
        notify(`Unlocked and opened ${doc.filename}`);
      }
    } catch (err: any) {
      setPasswordPrompt((prev) => (prev ? { ...prev, error: 'Incorrect password. Please try again.' } : null));
    }
  };

  const handleSave = async (saveAs = false) => {
    if (!activeDoc) return;
    try {
      let targetPath = activeDoc.file_path;
      if (saveAs || !targetPath) {
        if (window.vellumDesktop?.saveFileDialog) {
          const picked = await window.vellumDesktop.saveFileDialog(activeDoc.filename);
          if (!picked) return;
          targetPath = picked;
        } else {
          // Download directly in browser mode or prompt path
          const a = document.createElement('a');
          a.href = `${getApiBaseUrl()}/api/docs/${activeDoc.doc_id}/download`;
          a.download = activeDoc.filename;
          a.click();
          notify(`Downloaded ${activeDoc.filename}`);
          return;
        }
      }
      const res = await pdfApi.saveDoc(activeDoc.doc_id, targetPath || undefined, true);
      await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
      notify(
        `Saved atomically to ${res.saved_path}${res.backup_path ? ` (Backup: ${res.backup_path})` : ''}`
      );
    } catch (err: any) {
      notify(`Save error: ${err.message}`, 'warn');
    }
  };

  const handleUndo = async () => {
    if (!activeDoc || !activeDoc.can_undo) return;
    const res = await pdfApi.undo(activeDoc.doc_id);
    setSelectedSpan(null);
    setSelectedImage(null);
    await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
    notify(`Undid: ${res.undone_action || 'last change'}`);
  };

  const handleRedo = async () => {
    if (!activeDoc || !activeDoc.can_redo) return;
    const res = await pdfApi.redo(activeDoc.doc_id);
    setSelectedSpan(null);
    setSelectedImage(null);
    await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
    notify(`Redid: ${res.redone_action || 'action'}`);
  };

  const handleCloseTab = async (docId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await pdfApi.closeDoc(docId);
    const remaining = openDocs.filter((d) => d.doc_id !== docId);
    setOpenDocs(remaining);
    if (activeDocId === docId) {
      setActiveDocId(remaining[0]?.doc_id || null);
      setCurrentPage(0);
    }
  };

  // Keyboard shortcuts & Native Electron Menu Actions
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isInput = document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA';
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && key === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      } else if (e.key === 'F1') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      } else if (ctrl && key === 'n' && !isInput) {
        e.preventDefault();
        handleNewBlankDoc();
      } else if (ctrl && key === 'o' && !isInput) {
        e.preventDefault();
        handleNativeOrBrowserOpen();
      } else if (ctrl && key === 's') {
        e.preventDefault();
        handleSave(e.shiftKey);
      } else if (ctrl && key === 'd' && !isInput) {
        e.preventDefault();
        openDocumentPropertiesModal();
      } else if (ctrl && key === 'p') {
        e.preventDefault();
        if (window.vellumDesktop?.printDocument) window.vellumDesktop.printDocument();
        else window.print();
      } else if (ctrl && key === 'z' && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          handleUndo();
        }
      } else if (ctrl && (key === 'y' || (e.shiftKey && key === 'z'))) {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
        }
      } else if (ctrl && key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (ctrl && key === 'e' && !isInput) {
        e.preventDefault();
        setMode('edit');
      } else if (ctrl && (key === '=' || key === '+')) {
        e.preventDefault();
        setZoom((z) => Math.min(3.0, +(z + 0.2).toFixed(2)));
      } else if (ctrl && key === '-') {
        e.preventDefault();
        setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)));
      } else if (ctrl && key === '0') {
        e.preventDefault();
        setZoom(1.0);
      } else if (e.key === 'F9') {
        e.preventDefault();
        setLeftOpen((v) => !v);
      } else if (e.key === 'F10') {
        e.preventDefault();
        setRightOpen((v) => !v);
      } else if (ctrl && e.shiftKey && key === 't') {
        e.preventDefault();
        setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
      } else if (ctrl && e.shiftKey && key === 'r') {
        e.preventDefault();
        if (activeDoc) {
          pdfApi.rotatePages(activeDoc.doc_id, [currentPage], 90).then((s) => {
            refreshDocState(activeDoc.doc_id, currentPage, s);
          });
        }
      } else if (ctrl && key === 'w' && !isInput) {
        if (activeDocId) {
          e.preventDefault();
          handleCloseTab(activeDocId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    if (!window.vellumDesktop?.onMenuAction) return;
    return window.vellumDesktop.onMenuAction(async (payload) => {
      switch (payload.action) {
        case 'new-doc':
          handleNewBlankDoc();
          break;
        case 'open-file':
          handleNativeOrBrowserOpen();
          break;
        case 'open-sample':
          handleOpenSampleDoc();
          break;
        case 'open-cli-path':
          if (payload.filePath) {
            const doc = await pdfApi.openByPath(payload.filePath);
            setOpenDocs((prev) => [...prev, doc]);
            setActiveDocId(doc.doc_id);
          }
          break;
        case 'save':
          handleSave(false);
          break;
        case 'save-as':
          handleSave(true);
          break;
        case 'undo':
          handleUndo();
          break;
        case 'redo':
          handleRedo();
          break;
        case 'set-mode':
          if (payload.mode) setMode(payload.mode as EditorMode);
          break;
        case 'zoom-in':
          setZoom((z) => Math.min(3.0, +(z + 0.2).toFixed(2)));
          break;
        case 'zoom-out':
          setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)));
          break;
        case 'zoom-reset':
          setZoom(1.0);
          break;
        case 'toggle-left-sidebar':
          setLeftOpen((v) => !v);
          break;
        case 'toggle-right-panel':
          setRightOpen((v) => !v);
          break;
        case 'toggle-theme':
          setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
          break;
        case 'command-palette':
          setShowCommandPalette(true);
          break;
        case 'print':
          if (window.vellumDesktop?.printDocument) await window.vellumDesktop.printDocument();
          else window.print();
          break;
        case 'doc-properties':
          openDocumentPropertiesModal();
          break;
        case 'focus-search':
          searchInputRef.current?.focus();
          break;
        case 'insert-blank-page':
          if (activeDoc) {
            try {
              const res = await pdfApi.insertBlankPage(activeDoc.doc_id, currentPage + 1);
              setOpenDocs((prev) => prev.map((d) => (d.doc_id === activeDoc.doc_id ? res : d)));
              setCurrentPage((p) => p + 1);
              await refreshDocState(activeDoc.doc_id, currentPage + 1, res);
            } catch (err: any) {
              notify(`Failed to insert blank page: ${err?.message || err}`, 'warn');
            }
          }
          break;
        case 'rotate-page-cw':
          if (activeDoc) {
            try {
              const res = await pdfApi.rotatePages(activeDoc.doc_id, [currentPage], 90);
              setOpenDocs((prev) => prev.map((d) => (d.doc_id === activeDoc.doc_id ? res : d)));
              await refreshDocState(activeDoc.doc_id, currentPage, res);
            } catch (err: any) {
              notify(`Failed to rotate page: ${err?.message || err}`, 'warn');
            }
          }
          break;
        case 'next-tab':
          if (openDocs.length > 1) {
            const curIdx = openDocs.findIndex((d) => d.doc_id === activeDocId);
            const nextIdx = (curIdx + 1) % openDocs.length;
            setActiveDocId(openDocs[nextIdx].doc_id);
          }
          break;
        case 'close-tab':
          if (activeDocId) {
            handleCloseTab(activeDocId);
          }
          break;
        case 'open-recovery':
          setShowRecoveryModal(true);
          break;
        case 'backend-diag':
          setShowBackendDiag(true);
          break;
        case 'retry-backend':
          connectToBackend(true);
          break;
        case 'backend-error':
          if (payload.error) {
            setBackendErrorDetail(payload.error);
            if (payload.logs) setBackendLogs(payload.logs);
            setEngineState('error');
          }
          break;
        case 'about':
          setShowAboutModal(true);
          break;
      }
    });
  });

  // Direct PDF Content Stream Text Span Commit
  const handleCommitTextSpanEdit = async (deleteSpan = false) => {
    if (!activeDoc || !selectedSpan) return;
    try {
      const newTextVal = deleteSpan ? '' : editSpanText;
      const keepOrig =
        !deleteSpan &&
        editSpanFont === selectedSpan.font &&
        editSpanBold === selectedSpan.bold &&
        editSpanItalic === selectedSpan.italic &&
        editSpanAlign === 'left';

      const res = await pdfApi.editTextSpan(activeDoc.doc_id, currentPage, {
        orig_bbox: selectedSpan.bbox,
        orig_origin: selectedSpan.origin,
        new_bbox: editSpanBbox,
        new_text: newTextVal,
        font_name: editSpanFont,
        original_font: selectedSpan.font,
        font_size: Number(editSpanSize),
        color_hex: editSpanColor,
        bold: editSpanBold,
        italic: editSpanItalic,
        align: editSpanAlign,
        keep_original_font: keepOrig,
      });

      setSelectedSpan(null);
      await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
      if (res.fallback_used && res.fallback_reason) {
        notify(`Edited PDF stream (Fallback Note: ${res.fallback_reason})`, 'warn');
      } else {
        notify(
          deleteSpan
            ? 'Removed text glyphs directly from PDF content stream (background preserved).'
            : `Updated PDF content stream in-place (Font: ${res.applied_font}, zero white-box masking).`
        );
      }
    } catch (err: any) {
      notify(`Text edit failed: ${err.message}`, 'warn');
    }
  };

  // Direct Image Object Commit
  const handleCommitImageEdit = async (action: 'transform' | 'delete') => {
    if (!activeDoc || !selectedImage) return;
    try {
      const res = await pdfApi.editImage(activeDoc.doc_id, currentPage, {
        xref: selectedImage.xref,
        action,
        orig_bbox: selectedImage.bbox,
        new_bbox: editImgBbox,
        rotation: editImgRotation,
        crop_ratios: editImgCrop,
      });
      setSelectedImage(null);
      await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
      notify(action === 'delete' ? 'Deleted image from page stream.' : 'Updated image placement & geometry.');
    } catch (err: any) {
      notify(`Image edit failed: ${err.message}`, 'warn');
    }
  };

  const handleReplaceImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeDoc || !selectedImage) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = (reader.result as string).split(',')[1];
      const res = await pdfApi.editImage(activeDoc.doc_id, currentPage, {
        xref: selectedImage.xref,
        action: 'replace',
        orig_bbox: selectedImage.bbox,
        new_bbox: editImgBbox,
        replacement_image_base64: b64,
      });
      setSelectedImage(null);
      await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
      notify(`Replaced image xref=${selectedImage.xref} with ${file.name}`);
    };
    reader.readAsDataURL(file);
  };

  const handleInsertNewImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeDoc) return;
    const res = await pdfApi.insertImage(activeDoc.doc_id, currentPage, file, [80, 120, 280, 260], 0);
    await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
    notify(`Inserted image ${file.name} onto Page ${currentPage + 1}`);
  };

  // Unified Object Selection, Transformation, and Manipulation Handlers
  const selectManipulableObject = useCallback(
    (
      type: 'textbox' | 'shape' | 'image' | 'text_span',
      id: string,
      bbox: [number, number, number, number],
      data: any
    ) => {
      setSelectedObj({
        objectId: id,
        objectType: type,
        origBbox: [...bbox] as [number, number, number, number],
        currentBbox: [...bbox] as [number, number, number, number],
        data,
      });

      if (type === 'text_span') {
        setSelectedSpan(data as TextSpanObject);
        setEditSpanText(data.text || '');
        setEditSpanFont(data.font || 'helv');
        setEditSpanSize(data.size || 12);
        setEditSpanColor(data.color || data.color_hex || '#000000');
        setEditSpanBold(Boolean(data.bold));
        setEditSpanItalic(Boolean(data.italic));
        setEditSpanAlign(data.align || 'left');
        setEditSpanBbox([...bbox] as [number, number, number, number]);
      } else {
        setSelectedSpan(null);
      }

      if (type === 'image') {
        setSelectedImage(data as ImageObject);
        setEditImgBbox([...bbox] as [number, number, number, number]);
        setEditImgRotation(0);
        setEditImgCrop([0, 0, 1, 1]);
      } else {
        setSelectedImage(null);
      }

      if (type === 'shape') {
        setEditShapeStrokeWidth(data.stroke_width || 2.0);
        setEditShapeOpacity(data.opacity ?? 1.0);
      }

      setSelectedAnnot(null);
      setSelectedField(null);
      setRightOpen(true);
    },
    []
  );

  const commitObjectTransform = useCallback(
    async (
      obj: ActiveTransformState,
      newBbox: [number, number, number, number],
      action: 'move' | 'delete' | 'duplicate' | 'update_style' = 'move',
      extraProps: any = {}
    ) => {
      if (!activeDoc) return;
      try {
        const isTextSpan = obj.objectType === 'text_span';
        const isTextBox = obj.objectType === 'textbox';

        const textVal =
          extraProps.text ??
          (isTextSpan ? (obj.data?.text ?? editSpanText) : isTextBox ? obj.data?.text : undefined);
        const fontVal =
          extraProps.font_name ??
          (isTextSpan
            ? (obj.data?.font ?? editSpanFont)
            : isTextBox
            ? (obj.data?.font_name ?? obj.data?.font)
            : undefined);
        const sizeVal =
          extraProps.font_size ??
          (isTextSpan
            ? (obj.data?.size ?? editSpanSize)
            : isTextBox
            ? (obj.data?.font_size ?? obj.data?.size)
            : undefined);
        const colorVal =
          extraProps.color_hex ??
          (isTextSpan
            ? (obj.data?.color || obj.data?.color_hex || editSpanColor)
            : isTextBox
            ? (obj.data?.color_hex || obj.data?.color)
            : undefined);
        const boldVal =
          extraProps.bold ??
          (isTextSpan ? (obj.data?.bold ?? editSpanBold) : isTextBox ? obj.data?.bold : undefined);
        const italicVal =
          extraProps.italic ??
          (isTextSpan ? (obj.data?.italic ?? editSpanItalic) : isTextBox ? obj.data?.italic : undefined);
        const alignVal =
          extraProps.align ??
          (isTextSpan
            ? (obj.data?.align ?? editSpanAlign ?? 'left')
            : isTextBox
            ? (obj.data?.align ?? 'left')
            : undefined);
        const origOrigin = isTextSpan ? (obj.data?.origin ?? undefined) : undefined;

        const res = await pdfApi.transformObject(activeDoc.doc_id, currentPage, {
          object_id: obj.objectId,
          object_type: obj.objectType,
          action,
          orig_bbox: obj.origBbox,
          new_bbox: newBbox,
          orig_origin: origOrigin,
          text: textVal,
          font_name: fontVal,
          font_size: sizeVal,
          color_hex: colorVal,
          bold: boldVal,
          italic: italicVal,
          align: alignVal,
          image_xref: obj.objectType === 'image' ? obj.data?.xref : undefined,
          ...extraProps,
        });

        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);

        if (action === 'delete') {
          setSelectedObj(null);
          setSelectedSpan(null);
          notify(`Deleted ${obj.objectType} object from page.`);
        } else if (action === 'duplicate') {
          notify(`Duplicated ${obj.objectType} object.`);
        } else {
          let updatedBbox = [...newBbox] as [number, number, number, number];
          let updatedData = { ...obj.data, ...extraProps, bbox: updatedBbox };

          if (isTextSpan && res.objects?.text_spans) {
            const matched = res.objects.text_spans.find(
              (s) =>
                s.id === obj.objectId ||
                (s.text === textVal && Math.abs(s.bbox[0] - newBbox[0]) < 25 && Math.abs(s.bbox[1] - newBbox[1]) < 25)
            );
            if (matched) {
              updatedBbox = [...matched.bbox];
              updatedData = matched;
              setSelectedSpan(matched);
              setEditSpanText(matched.text);
              setEditSpanFont(matched.font);
              setEditSpanSize(matched.size);
              setEditSpanColor(matched.color);
              setEditSpanBold(matched.bold);
              setEditSpanItalic(matched.italic);
              setEditSpanBbox([...matched.bbox]);
            }
          } else if (isTextBox && res.objects?.vellum_boxes) {
            const matched = res.objects.vellum_boxes.find((b) => b.id === obj.objectId);
            if (matched) {
              updatedBbox = [...matched.bbox];
              updatedData = matched;
            }
          } else if (obj.objectType === 'shape' && res.objects?.vellum_shapes) {
            const matched = res.objects.vellum_shapes.find((s) => s.id === obj.objectId);
            if (matched) {
              updatedBbox = [...matched.bbox];
              updatedData = matched;
            }
          }

          setSelectedObj({
            ...obj,
            objectId: updatedData.id || obj.objectId,
            origBbox: updatedBbox,
            currentBbox: updatedBbox,
            data: updatedData,
          });
          notify(`Updated ${obj.objectType} position and geometry.`);
        }
      } catch (err: any) {
        notify(`Failed to transform ${obj.objectType}: ${err?.message || err}`, 'warn');
      }
    },
    [activeDoc, currentPage, refreshDocState, notify, editSpanText, editSpanFont, editSpanSize, editSpanColor, editSpanBold, editSpanItalic, editSpanAlign]
  );

  const handleStartDragMove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedObj) return;
    setActiveGesture({
      type: 'move',
      startMousePdf: [e.clientX, e.clientY],
      startBbox: [...selectedObj.currentBbox] as [number, number, number, number],
      currentBbox: [...selectedObj.currentBbox] as [number, number, number, number],
    });
  };

  const handleStartResize = (
    e: React.MouseEvent,
    handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedObj) return;
    setActiveGesture({
      type: 'resize',
      handle,
      startMousePdf: [e.clientX, e.clientY],
      startBbox: [...selectedObj.currentBbox] as [number, number, number, number],
      currentBbox: [...selectedObj.currentBbox] as [number, number, number, number],
    });
  };

  const handleStartEditText = (box: VellumBoxObject) => {
    setDraftTextBox({
      bbox: [...box.bbox],
      text: box.text,
      font: box.font || 'helv',
      size: box.size || 12,
      color: box.color || '#000000',
      bold: Boolean(box.bold),
      italic: Boolean(box.italic),
      align: (box.align as any) || 'left',
      editingExistingId: box.id,
    });
    setSelectedObj(null);
    setTimeout(() => {
      draftTextAreaRef.current?.focus();
    }, 50);
  };

  // Window gesture tracking for live dragging, resizing and snapping
  useEffect(() => {
    if (!activeGesture || !selectedObj) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      const dxPdf = (e.clientX - activeGesture.startMousePdf[0]) / zoom;
      const dyPdf = (e.clientY - activeGesture.startMousePdf[1]) / zoom;
      const [origX0, origY0, origX1, origY1] = activeGesture.startBbox;
      const origW = origX1 - origX0;
      const origH = origY1 - origY0;

      let newX0 = origX0;
      let newY0 = origY0;
      let newX1 = origX1;
      let newY1 = origY1;

      let guideX: number | undefined = undefined;
      let guideY: number | undefined = undefined;

      if (activeGesture.type === 'move') {
        newX0 = origX0 + dxPdf;
        newY0 = origY0 + dyPdf;
        newX1 = newX0 + origW;
        newY1 = newY0 + origH;

        if (newX0 < 0) {
          newX0 = 0;
          newX1 = origW;
        }
        if (newY0 < 0) {
          newY0 = 0;
          newY1 = origH;
        }
        if (newX1 > pageSizePt.width) {
          newX1 = pageSizePt.width;
          newX0 = Math.max(0, pageSizePt.width - origW);
        }
        if (newY1 > pageSizePt.height) {
          newY1 = pageSizePt.height;
          newY0 = Math.max(0, pageSizePt.height - origH);
        }

        // Snapping to page center axes (within 5 pt)
        const centerX = (newX0 + newX1) / 2;
        const centerY = (newY0 + newY1) / 2;
        const pageCenterX = pageSizePt.width / 2;
        const pageCenterY = pageSizePt.height / 2;

        if (Math.abs(centerX - pageCenterX) < 5) {
          const snapDiff = pageCenterX - centerX;
          newX0 += snapDiff;
          newX1 += snapDiff;
          guideX = pageCenterX;
        }
        if (Math.abs(centerY - pageCenterY) < 5) {
          const snapDiff = pageCenterY - centerY;
          newY0 += snapDiff;
          newY1 += snapDiff;
          guideY = pageCenterY;
        }
      } else if (activeGesture.type === 'resize' && activeGesture.handle) {
        const h = activeGesture.handle;
        const minW = 15;
        const minH = 10;

        if (h.includes('w')) {
          newX0 = Math.min(origX1 - minW, Math.max(0, origX0 + dxPdf));
        }
        if (h.includes('e')) {
          newX1 = Math.max(origX0 + minW, Math.min(pageSizePt.width, origX1 + dxPdf));
        }
        if (h.includes('n')) {
          newY0 = Math.min(origY1 - minH, Math.max(0, origY0 + dyPdf));
        }
        if (h.includes('s')) {
          newY1 = Math.max(origY0 + minH, Math.min(pageSizePt.height, origY1 + dyPdf));
        }
      }

      const updatedBbox: [number, number, number, number] = [
        +(newX0.toFixed(1)),
        +(newY0.toFixed(1)),
        +(newX1.toFixed(1)),
        +(newY1.toFixed(1)),
      ];

      setSelectedObj((prev) => (prev ? { ...prev, currentBbox: updatedBbox } : null));
      setSnapGuides({ x: guideX, y: guideY });
    };

    const handleGlobalMouseUp = async () => {
      setSnapGuides({});
      const gesture = activeGesture;
      setActiveGesture(null);

      if (!selectedObj || !activeDoc) return;
      const current = selectedObj.currentBbox;
      const orig = gesture.startBbox;
      if (
        Math.abs(current[0] - orig[0]) > 0.5 ||
        Math.abs(current[1] - orig[1]) > 0.5 ||
        Math.abs(current[2] - orig[2]) > 0.5 ||
        Math.abs(current[3] - orig[3]) > 0.5
      ) {
        await commitObjectTransform(selectedObj, current);
      }
    };

    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [activeGesture, selectedObj, zoom, pageSizePt, activeDoc, commitObjectTransform]);

  // Global Keyboard shortcuts: Escape, Delete, Duplicate, Clipboard, Arrow nudging
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      if (e.key === 'Escape') {
        if (activeGesture) {
          if (selectedObj) {
            setSelectedObj({
              ...selectedObj,
              currentBbox: [...selectedObj.origBbox],
            });
          }
          setActiveGesture(null);
          setSnapGuides({});
          notify('Transformation cancelled.');
        } else if (selectedObj) {
          setSelectedObj(null);
          setContextMenuPos(null);
        }
        return;
      }

      if (!selectedObj || !activeDoc) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        commitObjectTransform(selectedObj, selectedObj.currentBbox, 'delete');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        commitObjectTransform(selectedObj, selectedObj.currentBbox, 'duplicate');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        setClipboardObj({ ...selectedObj });
        notify(`Copied ${selectedObj.objectType} to clipboard.`);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        setClipboardObj({ ...selectedObj });
        commitObjectTransform(selectedObj, selectedObj.currentBbox, 'delete');
        notify(`Cut ${selectedObj.objectType} to clipboard.`);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        if (clipboardObj) {
          commitObjectTransform(clipboardObj, clipboardObj.currentBbox, 'duplicate');
        }
        return;
      }

      // Arrow keys nudging (1 pt standard, 10 pt with Shift)
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;

        const [x0, y0, x1, y1] = selectedObj.currentBbox;
        const w = x1 - x0;
        const h = y1 - y0;
        const nx0 = Math.max(0, Math.min(pageSizePt.width - w, x0 + dx));
        const ny0 = Math.max(0, Math.min(pageSizePt.height - h, y0 + dy));
        const newBbox: [number, number, number, number] = [
          +(nx0.toFixed(1)),
          +(ny0.toFixed(1)),
          +((nx0 + w).toFixed(1)),
          +((ny0 + h).toFixed(1)),
        ];
        commitObjectTransform(selectedObj, newBbox, 'move');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedObj, activeGesture, activeDoc, currentPage, pageSizePt, clipboardObj, commitObjectTransform, notify]);

  // Dismiss context menu on window click
  useEffect(() => {
    const handleDismissMenu = () => setContextMenuPos(null);
    window.addEventListener('click', handleDismissMenu);
    return () => window.removeEventListener('click', handleDismissMenu);
  }, []);

  const handleCommitDraftTextBox = async () => {
    if (!activeDoc || !draftTextBox) return;
    const trimmed = draftTextBox.text.trim();
    if (!trimmed) {
      if (draftTextBox.editingExistingId) {
        try {
          const res = await pdfApi.transformObject(activeDoc.doc_id, currentPage, {
            object_id: draftTextBox.editingExistingId,
            object_type: 'textbox',
            action: 'delete',
            orig_bbox: draftTextBox.bbox,
          });
          await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
          notify('Removed empty text box.');
        } catch (err: any) {
          notify(`Failed to remove empty text box: ${err?.message || err}`, 'warn');
        }
      }
      setDraftTextBox(null);
      return;
    }
    try {
      if (draftTextBox.editingExistingId) {
        const res = await pdfApi.transformObject(activeDoc.doc_id, currentPage, {
          object_id: draftTextBox.editingExistingId,
          object_type: 'textbox',
          action: 'move',
          orig_bbox: draftTextBox.bbox,
          new_bbox: draftTextBox.bbox,
          text: draftTextBox.text,
          font_name: draftTextBox.font,
          font_size: draftTextBox.size,
          color_hex: draftTextBox.color,
          bold: draftTextBox.bold,
          italic: draftTextBox.italic,
          align: draftTextBox.align,
        });
        setDraftTextBox(null);
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
        notify('Updated text box in PDF content stream.');
      } else {
        const res = await pdfApi.addTextObject(activeDoc.doc_id, currentPage, {
          text: draftTextBox.text,
          bbox: draftTextBox.bbox,
          font_name: draftTextBox.font,
          font_size: draftTextBox.size,
          color_hex: draftTextBox.color,
          bold: draftTextBox.bold,
          italic: draftTextBox.italic,
          align: draftTextBox.align,
          bg_hex: draftTextBox.bg_hex && draftTextBox.bg_hex !== 'transparent' ? draftTextBox.bg_hex : undefined,
          border_hex:
            draftTextBox.border_hex && draftTextBox.border_hex !== 'transparent'
              ? draftTextBox.border_hex
              : undefined,
        });
        setDraftTextBox(null);
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
        notify('Inserted text box into PDF content stream.');
      }
    } catch (err: any) {
      notify(`Failed to insert text box: ${err?.message || err}`, 'warn');
    }
  };

  const handleCancelDraftTextBox = () => {
    setDraftTextBox(null);
    notify('Text box insertion cancelled.');
  };

  const openParagraphEditorForBlock = useCallback(
    (block: TextBlockObject) => {
      setSelectedObj(null);
      setSelectedSpan(null);
      setDraftTextBox(null);
      const initialText = block.reflow_text ?? block.text;
      const initialRuns: TextRun[] =
        block.runs && block.runs.length > 0
          ? block.runs.map((r) => ({ ...r }))
          : [
              {
                text: initialText,
                font: block.dominant_font || 'helv',
                size: block.dominant_size || 12,
                color: block.dominant_color || '#000000',
                bold: Boolean(block.bold),
                italic: Boolean(block.italic),
                link_uri: null,
              },
            ];
      const joinedText = initialRuns.map((r) => r.text).join('');
      setDraftParagraph({
        blockId: block.id,
        origBbox: [...block.bbox] as [number, number, number, number],
        targetBbox: [...block.bbox] as [number, number, number, number],
        expectedOrigText: block.text,
        text: joinedText,
        runs: initialRuns,
        selectionRange: { start: 0, end: 0 },
        font: block.dominant_font || 'helv',
        originalFont: block.dominant_font || 'helv',
        size: block.dominant_size || 12,
        color: block.dominant_color || '#000000',
        bold: Boolean(block.bold),
        italic: Boolean(block.italic),
        align: (block.align as any) || 'left',
        lineHeight: block.line_height || 1.25,
        isMixedStyle: Boolean(block.is_mixed_style) || initialRuns.length > 1,
        hasSubsetFont: Boolean(block.has_subset_font),
        overflowInfo: null,
      });
      setRightOpen(true);
      setTimeout(() => {
        const el = draftParagraphRef.current;
        if (el) {
          serializeRunsToDom(el, initialRuns, zoom);
          el.focus({ preventScroll: true });
        }
      }, 40);
    },
    [zoom]
  );

  // Re-render rich spans cleanly if zoom changes while inline editor is open
  useEffect(() => {
    const el = draftParagraphRef.current;
    if (!draftParagraph || !el) return;
    const prevSel = getDomSelectionOffsets(el);
    serializeRunsToDom(el, draftParagraph.runs, zoom);
    if (document.activeElement === el) {
      setDomSelectionOffsets(el, prevSel.start, prevSel.end);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const applyParagraphStylePatch = useCallback(
    (patch: Partial<Pick<TextRun, 'font' | 'size' | 'color' | 'bold' | 'italic'>>) => {
      setDraftParagraph((prev) => {
        if (!prev) return null;
        const el = draftParagraphRef.current;
        const liveRange =
          el && document.activeElement === el ? getDomSelectionOffsets(el) : prev.selectionRange;
        const hasSelection = liveRange.end > liveRange.start;
        const nextRuns = hasSelection
          ? applyStyleToRange(prev.runs, liveRange.start, liveRange.end, patch)
          : prev.runs.map((r) => ({ ...r, ...patch }));
        const nextMixed = prev.isMixedStyle || nextRuns.length > 1;
        if (el) {
          serializeRunsToDom(el, nextRuns, zoom);
          el.focus({ preventScroll: true });
          setDomSelectionOffsets(el, liveRange.start, liveRange.end);
        }
        return {
          ...prev,
          runs: nextRuns,
          selectionRange: liveRange,
          font: !hasSelection && patch.font !== undefined ? patch.font : prev.font,
          size: !hasSelection && patch.size !== undefined ? patch.size : prev.size,
          color: !hasSelection && patch.color !== undefined ? patch.color : prev.color,
          bold: !hasSelection && patch.bold !== undefined ? patch.bold : prev.bold,
          italic: !hasSelection && patch.italic !== undefined ? patch.italic : prev.italic,
          isMixedStyle: nextMixed,
          overflowInfo: null,
        };
      });
    },
    [zoom]
  );

  const handleParagraphInspectorTextChange = useCallback(
    (newText: string) => {
      setDraftParagraph((prev) => {
        if (!prev) return null;
        const fallbackRun: TextRun = {
          text: '',
          font: prev.font,
          size: prev.size,
          color: prev.color,
          bold: prev.bold,
          italic: prev.italic,
          link_uri: null,
        };
        const nextRuns = replaceTextPreservingRuns(prev.runs, newText, fallbackRun);
        const el = draftParagraphRef.current;
        if (el) {
          serializeRunsToDom(el, nextRuns, zoom);
        }
        return {
          ...prev,
          text: newText,
          runs: nextRuns,
          overflowInfo: null,
        };
      });
    },
    [zoom]
  );

  const openParagraphEditorForSpan = useCallback(
    (span: TextSpanObject) => {
      const blocks = pageObjects?.text_blocks || [];
      let block = blocks.find((b) => b.span_ids?.includes(span.id));
      if (!block) {
        const cx = (span.bbox[0] + span.bbox[2]) * 0.5;
        const cy = (span.bbox[1] + span.bbox[3]) * 0.5;
        block = blocks.find(
          (b) => cx >= b.bbox[0] - 2 && cx <= b.bbox[2] + 2 && cy >= b.bbox[1] - 2 && cy <= b.bbox[3] + 2
        );
      }
      if (block) {
        openParagraphEditorForBlock(block);
      } else {
        // Fallback: synthesize a single-span paragraph block
        openParagraphEditorForBlock({
          id: span.id,
          block_index: span.block_index,
          bbox: span.bbox,
          text: span.text,
          reflow_text: span.text,
          span_ids: [span.id],
          dominant_font: span.font,
          dominant_size: span.size,
          dominant_color: span.color,
          bold: span.bold,
          italic: span.italic,
          line_height: 1.25,
          align: 'left',
          is_mixed_style: false,
          has_subset_font: span.is_subset_font,
          horizontal: true,
        });
      }
    },
    [pageObjects, openParagraphEditorForBlock]
  );

  const isLightHexColor = (hex: string): boolean => {
    const clean = (hex || '#000000').replace('#', '');
    if (clean.length !== 6) return false;
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.72;
  };

  const handleCommitDraftParagraph = async (
    overflowPolicy: 'check' | 'expand_box' | 'shrink_font' | 'force' = 'check'
  ) => {
    if (!activeDoc || !draftParagraph || isCommittingParagraph) return;
    setIsCommittingParagraph(true);
    try {
      const res = await pdfApi.editParagraph(activeDoc.doc_id, currentPage, {
        block_id: draftParagraph.blockId,
        orig_bbox: draftParagraph.origBbox,
        expected_orig_text: draftParagraph.expectedOrigText,
        new_text: draftParagraph.text,
        target_bbox: draftParagraph.targetBbox,
        font_name: draftParagraph.font,
        font_size: draftParagraph.size,
        color_hex: draftParagraph.color,
        bold: draftParagraph.bold,
        italic: draftParagraph.italic,
        align: draftParagraph.align,
        line_height: draftParagraph.lineHeight,
        keep_original_font: draftParagraph.font === draftParagraph.originalFont,
        overflow_policy: overflowPolicy,
        runs: draftParagraph.runs,
      });

      if (res.status === 'overflow') {
        setDraftParagraph((prev) =>
          prev ? { ...prev, overflowInfo: res.overflow_info || null } : null
        );
        notify('Paragraph text overflows its bounding box. Choose an overflow option.', 'warn');
        return;
      }

      setDraftParagraph(null);
      await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
      if (res.fallback_used && res.fallback_reason) {
        const fbDetail =
          res.font_warnings && res.font_warnings.length > 0
            ? `${res.font_warnings[0].original_font} → ${res.font_warnings[0].fallback_font}: ${res.font_warnings[0].reason}`
            : res.fallback_reason;
        notify(`Paragraph updated with font fallback (${fbDetail})`, 'warn');
      } else {
        notify(`Paragraph reflowed (${res.wrapped_line_count || 1} lines).`);
      }
    } catch (err: any) {
      notify(`Paragraph edit failed safely: ${err?.message || err}`, 'warn');
    } finally {
      setIsCommittingParagraph(false);
    }
  };

  const handleCancelDraftParagraph = () => {
    setDraftParagraph(null);
    notify('Paragraph editing cancelled; document unchanged.');
  };

  const handleCommitLinkDraft = async () => {
    if (!activeDoc || !linkDraftModal) return;
    const uri = linkDraftModal.uri.trim();
    if (!uri) {
      setLinkDraftModal(null);
      return;
    }
    try {
      const res = await pdfApi.manageHyperlink(activeDoc.doc_id, currentPage, {
        action: 'add',
        bbox: linkDraftModal.bbox,
        uri,
      });
      setLinkDraftModal(null);
      await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
      notify(`Added hyperlink -> ${uri}`);
    } catch (err: any) {
      notify(`Failed to add hyperlink: ${err?.message || err}`, 'warn');
    }
  };

  // Interactive Canvas Rubber-Band / Freehand Mouse Handlers
  const toPdfCoords = (clientX: number, clientY: number, el: HTMLElement): [number, number] => {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(pageSizePt.width, (clientX - rect.left) / zoom));
    const y = Math.max(0, Math.min(pageSizePt.height, (clientY - rect.top) / zoom));
    return [+(x.toFixed(1)), +(y.toFixed(1))];
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeDoc) return;
    if (subTool === 'select') {
      setSelectedObj(null);
      setSelectedSpan(null);
      setSelectedImage(null);
      setSelectedAnnot(null);
      setSelectedField(null);
      setContextMenuPos(null);
      return;
    }
    const [px, py] = toPdfCoords(e.clientX, e.clientY, e.currentTarget);
    setDragStart({ x: px, y: py });
    setDragCurrent({ x: px, y: py });
    if (subTool === 'ink') {
      setInkPoints([[px, py]]);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const [px, py] = toPdfCoords(e.clientX, e.clientY, e.currentTarget);
    setDragCurrent({ x: px, y: py });
    if (subTool === 'ink') {
      setInkPoints((prev) => [...prev, [px, py]]);
    }
  };

  const handleCanvasMouseUp = async () => {
    if (!activeDoc || !dragStart || !dragCurrent) return;
    const x0 = Math.min(dragStart.x, dragCurrent.x);
    const y0 = Math.min(dragStart.y, dragCurrent.y);
    const x1 = Math.max(dragStart.x, dragCurrent.x);
    const y1 = Math.max(dragStart.y, dragCurrent.y);
    const rawLineBox: [number, number, number, number] = [
      dragStart.x,
      dragStart.y,
      dragCurrent.x,
      dragCurrent.y,
    ];
    const bbox: [number, number, number, number] = [
      x0,
      y0,
      Math.max(x1, x0 + 90),
      Math.max(y1, y0 + 28),
    ];

    const drawnInk = [...inkPoints];
    setDragStart(null);
    setDragCurrent(null);
    setInkPoints([]);

    try {
      if (subTool === 'add-text') {
        const dragW = x1 - x0;
        const dragH = y1 - y0;
        const boxWidth = dragW > 15 ? dragW : 180;
        const boxHeight = dragH > 15 ? dragH : 56;
        const finalBbox: [number, number, number, number] = [
          x0,
          y0,
          +(Math.min(pageSizePt.width, x0 + boxWidth)).toFixed(1),
          +(Math.min(pageSizePt.height, y0 + boxHeight)).toFixed(1),
        ];
        setDraftTextBox({
          bbox: finalBbox,
          text: '',
          font: textBoxDefaults.font || 'helv',
          size: textBoxDefaults.size || 11,
          color: textBoxDefaults.color || '#000000',
          bold: false,
          italic: false,
          align: textBoxDefaults.align || 'left',
          bg_hex: textBoxDefaults.bg_hex || 'transparent',
          border_hex: textBoxDefaults.border_hex || 'transparent',
        });
        setSubTool('select');
        setSelectedSpan(null);
        setSelectedImage(null);
        setSelectedAnnot(null);
        setSelectedField(null);
        setTimeout(() => {
          draftTextAreaRef.current?.focus();
        }, 50);
      } else if (subTool.startsWith('shape-')) {
        const sType = subTool.replace('shape-', '');
        const shapeBox = sType === 'line' || sType === 'arrow' ? rawLineBox : bbox;
        const res = await pdfApi.addShape(activeDoc.doc_id, currentPage, {
          shape_type: sType,
          bbox: shapeBox,
          stroke_hex: toolColor,
          fill_hex: sType === 'rect' || sType === 'ellipse' ? toolFillColor : undefined,
          stroke_width: 2.0,
        });
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
        notify(`Added vector ${sType} to PDF content stream.`);
      } else if (subTool === 'add-link') {
        setLinkDraftModal({
          bbox,
          uri: 'https://',
        });
        setSubTool('select');
      } else if (
        ['highlight', 'underline', 'strikeout', 'sticky_note', 'freetext', 'ink', 'stamp'].includes(subTool)
      ) {
        const res = await pdfApi.addAnnotation(activeDoc.doc_id, {
          page_index: currentPage,
          annot_type: subTool,
          bbox,
          content: toolCommentText || `${subTool} comment`,
          author: toolAuthor,
          color_hex: toolColor,
          ink_strokes: subTool === 'ink' && drawnInk.length >= 2 ? [drawnInk] : undefined,
          stamp_name: toolStampName,
          font_size: toolFontSize,
        });
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
        notify(`Added ${subTool} annotation.`);
      } else if (subTool.startsWith('form-')) {
        const fType = subTool.replace('form-', '');
        const fname = `${fType}_${Date.now().toString().slice(-4)}`;
        const res = await pdfApi.createFormField(activeDoc.doc_id, {
          page_index: currentPage,
          field_type: fType,
          field_name: newFieldName || fname,
          bbox,
          default_value: newFieldDefault,
          choices: newFieldChoices.split(',').map((s) => s.trim()),
          font_size: 11,
          required: newFieldRequired,
          read_only: newFieldReadOnly,
          multiline: fType === 'multiline' || newFieldMultiline,
          max_length: newFieldMaxLen,
          align: newFieldAlign,
        });
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
        setSubTool('select');
        notify(`Created interactive AcroForm ${fType} widget.`);
      } else if (subTool === 'sig-visual') {
        const res = await pdfApi.applyVisualSignature(activeDoc.doc_id, {
          page_index: currentPage,
          bbox,
          mode: 'typed',
          signer_name: signerName,
          typed_text: signerName,
          color_hex: '#0f172a',
        });
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
        notify(res.notice);
      } else if (subTool === 'sig-crypto') {
        const res = await pdfApi.signCryptographic(activeDoc.doc_id, {
          page_index: currentPage,
          bbox,
          field_name: `CryptoSig_${Date.now().toString().slice(-4)}`,
          reason: signReason,
          location: signLocation,
          p12_base64: generatedP12B64 || undefined,
          passphrase: certPassphrase,
          signer_name: signerName,
          organization: signerOrg,
        });
        setSigVerification(res.verification);
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
        notify(`Applied cryptographic PKCS#12 X.509 digital signature (${res.signer_cn}).`);
      } else if (subTool === 'redact-box') {
        const res = await pdfApi.redactPdf(activeDoc.doc_id, {
          page_redactions: [{ page_index: currentPage, bbox, label: redactOverlayLabel }],
          overlay_text: redactOverlayLabel,
          fill_color_hex: '#000000',
        });
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
        notify('Permanently redacted selected region from PDF content and image streams.');
      }
    } catch (err: any) {
      notify(`Operation failed: ${err.message}`, 'warn');
    } finally {
      setSubTool('select');
    }
  };

  // Search handler
  const handleRunSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activeDoc) return;
    if (!searchQuery.trim()) {
      setSearchMatches([]);
      return;
    }
    const res = await pdfApi.searchDoc(activeDoc.doc_id, searchQuery);
    setSearchMatches(res.matches);
    if (res.matches.length > 0) {
      setCurrentPage(res.matches[0].page_index);
      notify(`Found ${res.total_matches} match(es) for "${searchQuery}".`);
    } else {
      notify(`No matches found for "${searchQuery}".`, 'warn');
    }
  };

  // Document Properties Modal
  const openDocumentPropertiesModal = async () => {
    if (!activeDoc) return;
    const props = await pdfApi.getProperties(activeDoc.doc_id);
    setDocPropsForm({
      title: props.title || '',
      author: props.author || '',
      subject: props.subject || '',
      keywords: props.keywords || '',
      creator: props.creator || '',
      producer: props.producer || '',
    });
    setShowPropsModal(true);
  };

  const handleSaveDocProperties = async () => {
    if (!activeDoc) return;
    const res = await pdfApi.setProperties(activeDoc.doc_id, docPropsForm);
    setShowPropsModal(false);
    await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
    notify('Updated PDF Document Info & XMP metadata.');
  };

  // Command Palette entries
  const commandList = useMemo(
    () => [
      { id: 'new', label: 'File: New Blank PDF Document', shortcut: 'Ctrl+N', run: handleNewBlankDoc },
      { id: 'sample', label: 'File: Open 3-Page Enterprise MSA Showcase PDF', shortcut: '', run: handleOpenSampleDoc },
      { id: 'open', label: 'File: Open PDF File...', shortcut: 'Ctrl+O', run: handleNativeOrBrowserOpen },
      { id: 'save', label: 'File: Safe Save PDF (with .bak backup)', shortcut: 'Ctrl+S', run: () => handleSave(false) },
      { id: 'undo', label: 'Edit: Undo Last PDF Operation', shortcut: 'Ctrl+Z', run: handleUndo },
      { id: 'redo', label: 'Edit: Redo PDF Operation', shortcut: 'Ctrl+Y', run: handleRedo },
      { id: 'm-edit', label: 'Mode: Direct PDF Content Editing (Text, Images, Shapes)', shortcut: 'Ctrl+E', run: () => setMode('edit') },
      { id: 'm-annot', label: 'Mode: Annotations, Markup & Stamps', shortcut: '', run: () => setMode('annotate') },
      { id: 'm-pages', label: 'Mode: Organize Pages (Insert, Reorder, Rotate, Crop, Split, Merge)', shortcut: '', run: () => setMode('pages') },
      { id: 'm-forms', label: 'Mode: Interactive AcroForm Designer & Filler', shortcut: '', run: () => setMode('forms') },
      { id: 'm-sign', label: 'Mode: Digital Signatures (X.509 PKCS#12 & Visual)', shortcut: '', run: () => setMode('sign') },
      { id: 'm-ocr', label: 'Mode: Offline Neural OCR & Document Conversions (DOCX, XLSX, HTML)', shortcut: '', run: () => setMode('ocr') },
      { id: 'm-sec', label: 'Mode: Security, AES-256 Encryption, Permanent Redaction & Compression', shortcut: '', run: () => setMode('security') },
      { id: 'm-pro', label: 'Mode: Compare PDFs, Watermarks, Bates Numbering, Preflight & PDF/A', shortcut: '', run: () => setMode('pro') },
      { id: 'theme', label: 'View: Toggle Dark / Light Theme', shortcut: 'Ctrl+Shift+T', run: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) },
      { id: 'props', label: 'Document: Edit Metadata & Properties', shortcut: 'Ctrl+D', run: openDocumentPropertiesModal },
    ],
    [activeDoc, currentPage]
  );

  const filteredCommands = useMemo(
    () =>
      commandList.filter((c) => c.label.toLowerCase().includes(paletteQuery.toLowerCase())),
    [commandList, paletteQuery]
  );

  const pageAnnotations = useMemo(
    () => annotations.filter((a) => a.page_index === currentPage),
    [annotations, currentPage]
  );

  const pageFormFields = useMemo(
    () => formFields.filter((f) => f.page_index === currentPage),
    [formFields, currentPage]
  );

  const pageSearchHits = useMemo(
    () => searchMatches.filter((m) => m.page_index === currentPage),
    [searchMatches, currentPage]
  );

  return (
    <div
      className={`app-shell theme-${theme} ${isMaximized ? 'is-maximized' : ''}`}
      onClick={() => {
        if (openMenu) setOpenMenu(null);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file && file.name.toLowerCase().endsWith('.pdf')) {
          const doc = await pdfApi.openUpload(file);
          setOpenDocs((prev) => [...prev, doc]);
          setActiveDocId(doc.doc_id);
          setCurrentPage(0);
          notify(`Opened dropped PDF: ${doc.filename}`);
        }
      }}
    >
      {/* Hidden File Upload Inputs */}
      <input ref={fileOpenInputRef} type="file" accept=".pdf" hidden onChange={handleBrowserFileUpload} />
      <input ref={imageInsertInputRef} type="file" accept="image/*" hidden onChange={handleInsertNewImageUpload} />
      <input ref={imageReplaceInputRef} type="file" accept="image/*" hidden onChange={handleReplaceImageUpload} />
      <input
        ref={attachmentInputRef}
        type="file"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !activeDoc) return;
          const res = await pdfApi.addAttachment(activeDoc.doc_id, file, 'Embedded via Vellum PDF Pro');
          await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
          notify(`Embedded attachment: ${file.name}`);
        }}
      />
      <input
        ref={insertPdfPagesInputRef}
        type="file"
        accept=".pdf"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file || !activeDoc) return;
          const summary = await pdfApi.insertPagesFromPdf(activeDoc.doc_id, file, currentPage + 1);
          await refreshDocState(activeDoc.doc_id, currentPage, summary);
          notify(`Inserted pages from ${file.name}`);
        }}
      />
      <input
        ref={docxConvertInputRef}
        type="file"
        accept=".docx"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const doc = await pdfApi.convertDocxToPdf(file);
          setOpenDocs((prev) => [...prev, doc]);
          setActiveDocId(doc.doc_id);
          setCurrentPage(0);
          notify(`Converted ${file.name} to PDF.`);
        }}
      />
      <input
        ref={imagesConvertInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (!files.length) return;
          const doc = await pdfApi.convertImagesToPdf(files, 'a4');
          setOpenDocs((prev) => [...prev, doc]);
          setActiveDocId(doc.doc_id);
          setCurrentPage(0);
          notify(`Combined ${files.length} image(s) into a new PDF.`);
        }}
      />

      {/* 1. TOP MENU BAR */}
      <header className="top-menubar" onClick={(e) => e.stopPropagation()}>
        <div className="menubar-left">
          <div
            className="brand-badge"
            title="Vellum PDF Pro — Click for About & Licensing"
            onClick={() => setShowAboutModal(true)}
          >
            <VellumMarkIcon size={18} />
          </div>

          {/* Menu: File */}
          <div className="menu-item-wrap">
            <button
              className={`menu-trigger ${openMenu === 'file' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
            >
              File
            </button>
            {openMenu === 'file' && (
              <div className="menu-dropdown" onClick={() => setOpenMenu(null)}>
                <button onClick={handleNewBlankDoc}>
                  <span>New Blank PDF</span>
                  <span className="kbd">Ctrl+N</span>
                </button>
                <button onClick={handleNativeOrBrowserOpen}>
                  <span>Open PDF...</span>
                  <span className="kbd">Ctrl+O</span>
                </button>
                <button onClick={handleOpenSampleDoc}>
                  <span>Open Showcase Sample PDF</span>
                </button>
                <button onClick={() => handleSave(false)}>
                  <span>Save (Safe Atomic + .bak)</span>
                  <span className="kbd">Ctrl+S</span>
                </button>
                <button onClick={() => handleSave(true)}>
                  <span>Save As / Download...</span>
                  <span className="kbd">Ctrl+Shift+S</span>
                </button>
                <button onClick={openDocumentPropertiesModal}>
                  <span>Document Properties...</span>
                  <span className="kbd">Ctrl+D</span>
                </button>
                <button
                  onClick={() => {
                    if (window.vellumDesktop?.printDocument) window.vellumDesktop.printDocument();
                    else window.print();
                  }}
                >
                  <span>Print Document...</span>
                  <span className="kbd">Ctrl+P</span>
                </button>
                {activeDocId && (
                  <button onClick={() => handleCloseTab(activeDocId)}>
                    <span>Close Current Tab</span>
                    <span className="kbd">Ctrl+W</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Menu: Edit */}
          <div className="menu-item-wrap">
            <button
              className={`menu-trigger ${openMenu === 'edit' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'edit' ? null : 'edit')}
            >
              Edit
            </button>
            {openMenu === 'edit' && (
              <div className="menu-dropdown" onClick={() => setOpenMenu(null)}>
                <button onClick={handleUndo} disabled={!activeDoc?.can_undo}>
                  <span>Undo</span>
                  <span className="kbd">Ctrl+Z</span>
                </button>
                <button onClick={handleRedo} disabled={!activeDoc?.can_redo}>
                  <span>Redo</span>
                  <span className="kbd">Ctrl+Y</span>
                </button>
                <button onClick={() => setMode('edit')}>
                  <span>Edit PDF Content Stream</span>
                  <span className="kbd">Ctrl+E</span>
                </button>
                <button onClick={() => searchInputRef.current?.focus()}>
                  <span>Find Text in PDF...</span>
                  <span className="kbd">Ctrl+F</span>
                </button>
                <button onClick={() => setShowCommandPalette(true)}>
                  <span>Command Palette...</span>
                  <span className="kbd">Ctrl+K</span>
                </button>
              </div>
            )}
          </div>

          {/* Menu: View */}
          <div className="menu-item-wrap">
            <button
              className={`menu-trigger ${openMenu === 'view' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
            >
              View
            </button>
            {openMenu === 'view' && (
              <div className="menu-dropdown" onClick={() => setOpenMenu(null)}>
                <button onClick={() => setZoom((z) => Math.min(3.0, +(z + 0.2).toFixed(2)))}>
                  <span>Zoom In</span>
                  <span className="kbd">Ctrl++</span>
                </button>
                <button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}>
                  <span>Zoom Out</span>
                  <span className="kbd">Ctrl+-</span>
                </button>
                <button onClick={() => setZoom(1.0)}>
                  <span>Actual Size (100%)</span>
                  <span className="kbd">Ctrl+0</span>
                </button>
                <button onClick={() => setLeftOpen((v) => !v)}>
                  <span>Toggle Left Navigation Sidebar</span>
                  <span className="kbd">F9</span>
                </button>
                <button onClick={() => setRightOpen((v) => !v)}>
                  <span>Toggle Right Inspector Panel</span>
                  <span className="kbd">F10</span>
                </button>
                <button onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
                  <span>Switch Theme ({theme === 'dark' ? 'Light' : 'Dark'})</span>
                </button>
              </div>
            )}
          </div>

          {/* Menu: Document */}
          <div className="menu-item-wrap">
            <button
              className={`menu-trigger ${openMenu === 'document' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'document' ? null : 'document')}
            >
              Document
            </button>
            {openMenu === 'document' && (
              <div className="menu-dropdown" onClick={() => setOpenMenu(null)}>
                <button
                  onClick={async () => {
                    if (!activeDoc) return;
                    const s = await pdfApi.insertBlankPage(activeDoc.doc_id, currentPage + 1);
                    await refreshDocState(activeDoc.doc_id, currentPage + 1, s);
                  }}
                >
                  <span>Insert Blank Page After Current</span>
                </button>
                <button
                  onClick={async () => {
                    if (!activeDoc) return;
                    const s = await pdfApi.duplicatePage(activeDoc.doc_id, currentPage);
                    await refreshDocState(activeDoc.doc_id, currentPage + 1, s);
                  }}
                >
                  <span>Duplicate Current Page</span>
                </button>
                <button
                  onClick={async () => {
                    if (!activeDoc) return;
                    const s = await pdfApi.rotatePages(activeDoc.doc_id, [currentPage], 90);
                    await refreshDocState(activeDoc.doc_id, currentPage, s);
                  }}
                >
                  <span>Rotate Page 90° CW</span>
                </button>
                <button onClick={() => setMode('pages')}>
                  <span>Crop, Resize, Split & Merge Pages...</span>
                </button>
                <button onClick={() => setMode('pro')}>
                  <span>Headers, Footers, Watermarks & Bates...</span>
                </button>
              </div>
            )}
          </div>

          {/* Menu: Tools */}
          <div className="menu-item-wrap">
            <button
              className={`menu-trigger ${openMenu === 'tools' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'tools' ? null : 'tools')}
            >
              Tools
            </button>
            {openMenu === 'tools' && (
              <div className="menu-dropdown" onClick={() => setOpenMenu(null)}>
                <button onClick={() => setMode('edit')}>
                  <span>Direct Content Editor (Text & Images)</span>
                </button>
                <button onClick={() => setMode('annotate')}>
                  <span>Comments, Markup & Stamps</span>
                </button>
                <button onClick={() => setMode('forms')}>
                  <span>Interactive AcroForm Designer</span>
                </button>
                <button onClick={() => setMode('sign')}>
                  <span>PKCS#12 Digital Signatures</span>
                </button>
                <button onClick={() => setMode('ocr')}>
                  <span>Offline Neural OCR & Export (DOCX/XLSX)</span>
                </button>
                <button onClick={() => setMode('security')}>
                  <span>Permanent Redaction & AES-256 Security</span>
                </button>
                <button onClick={() => setMode('pro')}>
                  <span>Compare PDFs, Accessibility & PDF/A-2b</span>
                </button>
              </div>
            )}
          </div>

          {/* Menu: Window */}
          <div className="menu-item-wrap">
            <button
              className={`menu-trigger ${openMenu === 'window' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'window' ? null : 'window')}
            >
              Window
            </button>
            {openMenu === 'window' && (
              <div className="menu-dropdown" onClick={() => setOpenMenu(null)}>
                {window.vellumDesktop?.isDesktopApp && (
                  <>
                    <button onClick={handleMinimizeWindow}>
                      <span>Minimize Window</span>
                    </button>
                    <button onClick={handleToggleMaximize}>
                      <span>{isMaximized ? 'Restore Window' : 'Maximize Window'}</span>
                      <span className="kbd">F11</span>
                    </button>
                    <button onClick={handleCloseWindow}>
                      <span>Close Window</span>
                      <span className="kbd">Alt+F4</span>
                    </button>
                    <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
                  </>
                )}
                {openDocs.length > 1 && (
                  <button
                    onClick={() => {
                      const idx = openDocs.findIndex((d) => d.doc_id === activeDocId);
                      const next = openDocs[(idx + 1) % openDocs.length];
                      if (next) setActiveDocId(next.doc_id);
                    }}
                  >
                    <span>Next Document Tab</span>
                    <span className="kbd">Ctrl+Tab</span>
                  </button>
                )}
                <button
                  onClick={async () => {
                    const rec = await pdfApi.listRecovery();
                    setRecoveryList(rec);
                    setShowRecoveryModal(true);
                  }}
                >
                  <span>Crash Recovery Manager ({recoveryList.length})</span>
                </button>
                <button
                  onClick={async () => {
                    if (!activeDoc) return;
                    const f = await pdfApi.getFonts(activeDoc.doc_id);
                    setFontsList(f);
                    setLeftOpen(true);
                    setLeftTab('fonts');
                  }}
                >
                  <span>Embedded Font Inspector</span>
                </button>
              </div>
            )}
          </div>

          {/* Menu: Help */}
          <div className="menu-item-wrap">
            <button
              className={`menu-trigger ${openMenu === 'help' ? 'active' : ''}`}
              onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}
            >
              Help
            </button>
            {openMenu === 'help' && (
              <div className="menu-dropdown" onClick={() => setOpenMenu(null)}>
                <button onClick={() => setShowCommandPalette(true)}>
                  <span>Searchable Command Palette</span>
                  <span className="kbd">Ctrl+K / F1</span>
                </button>
                <button
                  onClick={async () => {
                    const rec = await pdfApi.listRecovery();
                    setRecoveryList(rec);
                    setShowRecoveryModal(true);
                  }}
                >
                  <span>Crash Recovery Manager ({recoveryList.length})</span>
                </button>
                <button onClick={() => setShowBackendDiag(true)}>
                  <span>Backend Diagnostics & Logs</span>
                </button>
                <button onClick={() => connectToBackend(true)}>
                  <span>Retry Backend Connection</span>
                </button>
                <button onClick={() => setShowAboutModal(true)}>
                  <span>About Vellum PDF Pro & Licensing</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Center Draggable Window Header / Document Title */}
        <div
          className="menubar-drag-region"
          onDoubleClick={handleToggleMaximize}
          title="Drag to move · Double-click to maximize or restore"
        >
          <span className="window-title-caption">
            {activeDoc ? `${activeDoc.filename} — Vellum PDF Pro` : 'Vellum PDF Pro'}
          </span>
        </div>

        {/* Right side of Top Menu Bar: Search, Command Palette, Theme Toggle, Window Controls */}
        <div className="menubar-right">
          <form onSubmit={handleRunSearch} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search in PDF (Ctrl+F)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 165, height: 24, fontSize: 11.5 }}
            />
            {searchMatches.length > 0 && (
              <span className="badge pass" style={{ cursor: 'pointer' }} onClick={() => setSearchMatches([])}>
                {searchMatches.length} hits ×
              </span>
            )}
          </form>

          <button className="menu-trigger" onClick={() => setShowCommandPalette(true)} title="Command Palette (Ctrl+K)">
            <Command size={13} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Palette
          </button>

          <button
            className="menu-trigger"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            title="Toggle Light / Dark Theme"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* Integrated Frameless Window Controls */}
          {window.vellumDesktop?.isDesktopApp && (
            <div className="window-controls" aria-label="Window Management Controls">
              <button
                type="button"
                className="window-control-btn minimize"
                onClick={handleMinimizeWindow}
                title="Minimize Window"
                aria-label="Minimize Window"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="2" y="8" width="12" height="1.6" />
                </svg>
              </button>
              <button
                type="button"
                className="window-control-btn maximize"
                onClick={handleToggleMaximize}
                title={isMaximized ? 'Restore Window (F11)' : 'Maximize Window (F11)'}
                aria-label={isMaximized ? 'Restore Window' : 'Maximize Window'}
              >
                {isMaximized ? (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M4.5 4.5V1.5h10v10h-3" />
                    <rect x="1.5" y="4.5" width="10" height="10" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <rect x="1.5" y="1.5" width="13" height="13" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="window-control-btn close"
                onClick={handleCloseWindow}
                title="Close Vellum PDF Pro (Alt+F4)"
                aria-label="Close Vellum PDF Pro"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M2.5 2.5l11 11M13.5 2.5l-11 11" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* 2. MULTI-DOCUMENT TAB BAR */}
      <div className="doc-tabbar">
        {openDocs.map((doc) => (
          <div
            key={doc.doc_id}
            className={`doc-tab ${doc.doc_id === activeDocId ? 'active' : ''}`}
            onClick={() => {
              setActiveDocId(doc.doc_id);
              setCurrentPage(0);
              setSelectedSpan(null);
              setSelectedImage(null);
            }}
          >
            {doc.dirty && <span className="dirty-dot" title="Unsaved changes" />}
            {doc.is_encrypted && <Lock size={12} color="#f59e0b" />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.filename}</span>
            <span style={{ fontSize: 10.5, opacity: 0.65 }}>({doc.page_count}p)</span>
            <button className="tab-close" onClick={(e) => handleCloseTab(doc.doc_id, e)} title="Close Tab">
              <X size={12} />
            </button>
          </div>
        ))}
        <button className="tool-btn" style={{ padding: '3px 8px' }} onClick={handleNewBlankDoc} title="New Blank PDF">
          <Plus size={13} /> New
        </button>
        <button className="tool-btn" style={{ padding: '3px 8px' }} onClick={handleNativeOrBrowserOpen} title="Open PDF">
          <FolderOpen size={13} /> Open
        </button>
        <button className="tool-btn" style={{ padding: '3px 8px' }} onClick={handleOpenSampleDoc} title="Open Showcase PDF">
          <Sparkles size={13} /> Sample MSA
        </button>
      </div>

      {/* 3. PRIMARY MODE & CONTEXTUAL TOOL RIBBON */}
      <div className="main-toolbar">
        <div className="mode-strip">
          <div className="mode-pills">
            {(
              [
                ['view', 'View', Eye],
                ['edit', 'Edit PDF', Edit3],
                ['annotate', 'Annotate', Highlighter],
                ['pages', 'Organize Pages', Layers],
                ['forms', 'Forms', FileText],
                ['sign', 'Sign & Certify', PenTool],
                ['ocr', 'OCR & Convert', ScanText],
                ['security', 'Security & Redact', ShieldAlert],
                ['pro', 'Pro & Compare', Columns],
              ] as Array<[EditorMode, string, any]>
            ).map(([mKey, label, Icon]) => (
              <button
                key={mKey}
                className={`mode-btn ${mode === mKey ? 'active' : ''}`}
                onClick={() => {
                  setMode(mKey);
                  setSubTool('select');
                }}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button className="tool-btn" onClick={handleUndo} disabled={!activeDoc?.can_undo} title="Undo (Ctrl+Z)">
              <Undo2 size={14} /> Undo ({activeDoc?.undo_count || 0})
            </button>
            <button className="tool-btn" onClick={handleRedo} disabled={!activeDoc?.can_redo} title="Redo (Ctrl+Y)">
              <Redo2 size={14} /> Redo ({activeDoc?.redo_count || 0})
            </button>
            <button className="tool-btn primary" onClick={() => handleSave(false)} disabled={!activeDoc}>
              <Save size={14} /> Save PDF
            </button>
          </div>
        </div>

        {/* Contextual Sub-Toolbar per Mode */}
        <div className="sub-toolbar">
          {mode === 'view' && (
            <>
              <button className="tool-btn" onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}>
                <ChevronLeft size={14} /> Prev Page
              </button>
              <button
                className="tool-btn"
                onClick={() =>
                  setCurrentPage((p) => Math.min((activeDoc?.page_count || 1) - 1, p + 1))
                }
              >
                Next Page <ChevronRight size={14} />
              </button>
              <div className="toolbar-divider" />
              <button className="tool-btn" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.15).toFixed(2)))}>
                <ZoomOut size={14} />
              </button>
              <span style={{ fontWeight: 600, minWidth: 48, textAlign: 'center' }}>
                {Math.round(zoom * 100)}%
              </span>
              <button className="tool-btn" onClick={() => setZoom((z) => Math.min(3.0, +(z + 0.15).toFixed(2)))}>
                <ZoomIn size={14} />
              </button>
              <button className="tool-btn" onClick={() => setZoom(1.0)}>
                100%
              </button>
              <button className="tool-btn" onClick={() => setZoom(1.25)}>
                Fit Width
              </button>
              <div className="toolbar-divider" />
              <button className="tool-btn" onClick={openDocumentPropertiesModal}>
                <FileText size={14} /> Document Properties
              </button>
            </>
          )}

          {mode === 'edit' && (
            <>
              <button
                className={`tool-btn ${subTool === 'select' ? 'active' : ''}`}
                onClick={() => setSubTool('select')}
              >
                <Move size={14} /> Select / Edit Existing Text & Images
              </button>
              <button
                className={`tool-btn ${subTool === 'edit-paragraph' ? 'active' : ''}`}
                onClick={() => {
                  setSubTool('edit-paragraph');
                  setSelectedObj(null);
                }}
                title="Select an existing paragraph block for Acrobat-style multiline reflow editing"
              >
                <FileText size={14} /> Edit Paragraph
              </button>
              <button
                className={`tool-btn ${subTool === 'add-text' ? 'active' : ''}`}
                onClick={() => setSubTool('add-text')}
              >
                <Type size={14} /> + Add Text Box (Drag on Page)
              </button>
              <button className="tool-btn" onClick={() => imageInsertInputRef.current?.click()}>
                <ImageIcon size={14} /> + Insert Image
              </button>
              <div className="toolbar-divider" />
              <button
                className={`tool-btn ${subTool === 'shape-rect' ? 'active' : ''}`}
                onClick={() => setSubTool('shape-rect')}
              >
                <Square size={14} /> Rectangle
              </button>
              <button
                className={`tool-btn ${subTool === 'shape-ellipse' ? 'active' : ''}`}
                onClick={() => setSubTool('shape-ellipse')}
              >
                Ellipse
              </button>
              <button
                className={`tool-btn ${subTool === 'shape-arrow' ? 'active' : ''}`}
                onClick={() => setSubTool('shape-arrow')}
              >
                Arrow
              </button>
              <button
                className={`tool-btn ${subTool === 'add-link' ? 'active' : ''}`}
                onClick={() => setSubTool('add-link')}
              >
                <LinkIcon size={14} /> Hyperlink
              </button>
              <div className="toolbar-divider" />
              <span style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>
                Click any blue dashed text box or green image box on the canvas to edit the PDF content stream directly.
              </span>
            </>
          )}

          {mode === 'annotate' && (
            <>
              {(
                [
                  ['select', 'Select'],
                  ['highlight', 'Highlight'],
                  ['underline', 'Underline'],
                  ['strikeout', 'Strikethrough'],
                  ['sticky_note', 'Sticky Note'],
                  ['freetext', 'Text Callout'],
                  ['ink', 'Freehand Ink'],
                  ['stamp', 'Stamp'],
                ] as Array<[SubTool, string]>
              ).map(([st, lbl]) => (
                <button
                  key={st}
                  className={`tool-btn ${subTool === st ? 'active' : ''}`}
                  onClick={() => setSubTool(st)}
                >
                  {lbl}
                </button>
              ))}
              <div className="toolbar-divider" />
              <input
                type="color"
                value={toolColor}
                onChange={(e) => setToolColor(e.target.value)}
                title="Annotation Color"
                style={{ width: 28, height: 26, border: 'none', background: 'transparent', cursor: 'pointer' }}
              />
              <select
                value={toolStampName}
                onChange={(e) => setToolStampName(e.target.value)}
                style={{ width: 135 }}
              >
                <option value="APPROVED">Stamp: APPROVED</option>
                <option value="CONFIDENTIAL">Stamp: CONFIDENTIAL</option>
                <option value="DRAFT">Stamp: DRAFT</option>
                <option value="FINAL">Stamp: FINAL</option>
                <option value="FORCOMMENT">Stamp: FOR COMMENT</option>
                <option value="VOID">Stamp: VOID</option>
              </select>
            </>
          )}

          {mode === 'pages' && activeDoc && (
            <>
              <button
                className="tool-btn"
                onClick={async () => {
                  const s = await pdfApi.insertBlankPage(activeDoc.doc_id, currentPage + 1);
                  await refreshDocState(activeDoc.doc_id, currentPage + 1, s);
                  notify('Inserted blank page.');
                }}
              >
                <FilePlus size={14} /> + Blank Page
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const s = await pdfApi.duplicatePage(activeDoc.doc_id, currentPage);
                  await refreshDocState(activeDoc.doc_id, currentPage + 1, s);
                  notify(`Duplicated Page ${currentPage + 1}.`);
                }}
              >
                <Copy size={14} /> Duplicate Page
              </button>
              <button
                className="tool-btn danger"
                disabled={activeDoc.page_count <= 1}
                onClick={async () => {
                  const s = await pdfApi.deletePages(activeDoc.doc_id, [currentPage]);
                  await refreshDocState(activeDoc.doc_id, Math.max(0, currentPage - 1), s);
                  notify(`Deleted Page ${currentPage + 1}.`);
                }}
              >
                <Trash2 size={14} /> Delete Page
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const newTab = await pdfApi.extractPages(activeDoc.doc_id, [currentPage]);
                  setOpenDocs((prev) => [...prev, newTab]);
                  setActiveDocId(newTab.doc_id);
                  setCurrentPage(0);
                  notify(`Extracted Page ${currentPage + 1} into a new document tab.`);
                }}
              >
                <Scissors size={14} /> Extract Page
              </button>
              <div className="toolbar-divider" />
              <button
                className="tool-btn"
                onClick={async () => {
                  const s = await pdfApi.rotatePages(activeDoc.doc_id, [currentPage], -90);
                  await refreshDocState(activeDoc.doc_id, currentPage, s);
                }}
              >
                <RotateCcw size={14} /> -90°
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const s = await pdfApi.rotatePages(activeDoc.doc_id, [currentPage], 90);
                  await refreshDocState(activeDoc.doc_id, currentPage, s);
                }}
              >
                <RotateCw size={14} /> +90°
              </button>
              <button className="tool-btn" onClick={() => insertPdfPagesInputRef.current?.click()}>
                <Upload size={14} /> Insert PDF File...
              </button>
              {openDocs.length >= 2 && (
                <button
                  className="tool-btn primary"
                  onClick={async () => {
                    const merged = await pdfApi.mergeOpenDocs(
                      openDocs.map((d) => d.doc_id),
                      'Merged_All_Tabs.pdf'
                    );
                    setOpenDocs((prev) => [...prev, merged]);
                    setActiveDocId(merged.doc_id);
                    setCurrentPage(0);
                    notify(`Merged ${openDocs.length} open tabs into ${merged.filename}`);
                  }}
                >
                  Merge All Open Tabs ({openDocs.length})
                </button>
              )}
            </>
          )}

          {mode === 'forms' && activeDoc && (
            <>
              <button
                className={`tool-btn ${formSubMode === 'fill' ? 'primary' : ''}`}
                onClick={() => {
                  setFormSubMode('fill');
                  setSubTool('select');
                }}
              >
                Fill Form
              </button>
              <button
                className={`tool-btn ${formSubMode === 'prepare' ? 'primary' : ''}`}
                onClick={() => {
                  setFormSubMode('prepare');
                  setRightOpen(true);
                }}
              >
                Prepare Form
              </button>
              <div className="toolbar-divider" />
              {formSubMode === 'fill' ? (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '0 6px' }}>
                    <input
                      type="checkbox"
                      checked={formAutoFit}
                      onChange={(e) => setFormAutoFit(e.target.checked)}
                    />
                    Auto-Fit Text
                  </label>
                  <button
                    className="tool-btn primary"
                    onClick={async () => {
                      const res = await pdfApi.fillFormFields(activeDoc.doc_id, formDraftValues, undefined, formAutoFit);
                      const warns = res.warnings || [];
                      setFormFillWarnings(warns);
                      await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                      if (warns.length > 0) {
                        notify(`Saved form values with ${warns.length} fitting/length warning(s).`, 'warn');
                      } else {
                        notify('Saved filled AcroForm field values into PDF stream.');
                      }
                    }}
                  >
                    <CheckCircle2 size={14} /> Save Filled Values
                  </button>
                  {pageFormFields.length === 0 && (
                    <button
                      className="tool-btn"
                      onClick={async () => {
                        setFormSubMode('prepare');
                        setSubTool('select');
                        const res = await pdfApi.detectFormCandidates(activeDoc.doc_id, currentPage);
                        const cands = (res.candidates || []).map((c) => ({ ...c, accepted: true }));
                        setFormCandidates(cands);
                        setRightOpen(true);
                        notify(
                          cands.length > 0
                            ? `Switched to Prepare Form and detected ${cands.length} candidate field(s) on Page ${currentPage + 1}.`
                            : `Switched to Prepare Form. No static candidates detected on Page ${currentPage + 1}.`
                        );
                      }}
                    >
                      <Sparkles size={14} /> Detect Fields
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    className="tool-btn"
                    onClick={async () => {
                      const res = await pdfApi.detectFormCandidates(activeDoc.doc_id, currentPage);
                      const cands = (res.candidates || []).map((c) => ({ ...c, accepted: true }));
                      setFormCandidates(cands);
                      setRightOpen(true);
                      notify(
                        cands.length > 0
                          ? `Detected ${cands.length} potential form field(s) on Page ${currentPage + 1}. Review overlays or Inspector, then Confirm.`
                          : `No static box/checkbox candidates detected on Page ${currentPage + 1}.`
                      );
                    }}
                  >
                    <Sparkles size={14} /> Detect Fields
                  </button>
                  {formCandidates.length > 0 && (
                    <>
                      <button
                        className="tool-btn primary"
                        onClick={async () => {
                          let lastSummary = activeDoc;
                          for (const c of formCandidates) {
                            const res = await pdfApi.createFormField(activeDoc.doc_id, {
                              page_index: c.page_index,
                              field_type: c.field_type,
                              field_name: c.field_name,
                              bbox: c.bbox,
                              multiline: c.field_type === 'multiline',
                              tooltip: c.label,
                              fill_color_hex: 'transparent',
                              border_color_hex: 'transparent',
                            });
                            lastSummary = res.summary;
                          }
                          const count = formCandidates.length;
                          setFormCandidates([]);
                          setFormSubMode('fill');
                          setSubTool('select');
                          await refreshDocState(activeDoc.doc_id, currentPage, lastSummary);
                          notify(`Accepted and inserted all ${count} detected form field(s).`);
                        }}
                      >
                        Accept All ({formCandidates.length})
                      </button>
                      <button
                        className="tool-btn"
                        onClick={async () => {
                          const selected = formCandidates.filter((c) => c.accepted !== false);
                          let lastSummary = activeDoc;
                          for (const c of selected) {
                            const res = await pdfApi.createFormField(activeDoc.doc_id, {
                              page_index: c.page_index,
                              field_type: c.field_type,
                              field_name: c.field_name,
                              bbox: c.bbox,
                              multiline: c.field_type === 'multiline',
                              tooltip: c.label,
                              fill_color_hex: 'transparent',
                              border_color_hex: 'transparent',
                            });
                            lastSummary = res.summary;
                          }
                          setFormCandidates([]);
                          setFormSubMode('fill');
                          setSubTool('select');
                          await refreshDocState(activeDoc.doc_id, currentPage, lastSummary);
                          notify(`Inserted ${selected.length} confirmed form field(s).`);
                        }}
                      >
                        Confirm Selected ({formCandidates.filter((c) => c.accepted !== false).length})
                      </button>
                      <button className="tool-btn" onClick={() => setFormCandidates([])}>
                        Cancel
                      </button>
                    </>
                  )}
                  <div className="toolbar-divider" />
                  {(
                    [
                      ['select', 'Select / Adjust'],
                      ['form-text', '+ Text'],
                      ['form-multiline', '+ Multiline'],
                      ['form-checkbox', '+ Checkbox'],
                      ['form-radio', '+ Radio'],
                      ['form-dropdown', '+ Dropdown'],
                      ['form-listbox', '+ List Box'],
                      ['form-signature', '+ Signature'],
                    ] as Array<[SubTool, string]>
                  ).map(([st, lbl]) => (
                    <button
                      key={st}
                      className={`tool-btn ${subTool === st ? 'active' : ''}`}
                      onClick={() => setSubTool(st)}
                    >
                      {lbl}
                    </button>
                  ))}
                </>
              )}
            </>
          )}

          {mode === 'sign' && activeDoc && (
            <>
              <button
                className={`tool-btn ${subTool === 'sig-visual' ? 'active' : ''}`}
                onClick={() => setSubTool('sig-visual')}
              >
                <PenTool size={14} /> Place Visual Signature (Drag on Page)
              </button>
              <button
                className={`tool-btn primary ${subTool === 'sig-crypto' ? 'active' : ''}`}
                onClick={() => setSubTool('sig-crypto')}
              >
                <KeyRound size={14} /> Place Cryptographic X.509 Signature (Drag on Page)
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const v = await pdfApi.verifySignatures(activeDoc.doc_id);
                  setSigVerification(v);
                  notify(
                    v.has_cryptographic_signatures
                      ? `Verified ${v.signature_count} cryptographic signature(s): ${v.all_intact ? 'ALL INTACT' : 'TAMPERED'}`
                      : 'No cryptographic PKCS#7/CMS signatures present in this document.'
                  );
                }}
              >
                <ShieldCheck size={14} /> Verify Digital Signatures
              </button>
            </>
          )}

          {mode === 'ocr' && activeDoc && (
            <>
              <select value={ocrLang} onChange={(e) => setOcrLang(e.target.value)} style={{ width: 170 }}>
                <option value="eng">OCR Language: English</option>
                <option value="deu">OCR Language: German</option>
                <option value="fra">OCR Language: French</option>
                <option value="spa">OCR Language: Spanish</option>
                <option value="chi_sim">OCR Language: Chinese</option>
                <option value="multi">OCR Language: Multilingual</option>
              </select>
              <button
                className="tool-btn primary"
                onClick={async () => {
                  notify('Running offline neural OCR on current page...');
                  const res = await pdfApi.runOcr(activeDoc.doc_id, {
                    page_indices: [currentPage],
                    language: ocrLang,
                    dpi: ocrDpi,
                    force_ocr_on_existing_text: ocrForce,
                  });
                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                  notify(`OCR complete (${res.engine}): embedded ${res.total_lines_added} searchable text lines.`);
                }}
              >
                <ScanText size={14} /> Run OCR on Page
              </button>
              <div className="toolbar-divider" />
              <button
                className="tool-btn"
                onClick={() => window.open(`${getApiBaseUrl()}/api/docs/${activeDoc.doc_id}/export/docx`)}
              >
                Export DOCX
              </button>
              <button
                className="tool-btn"
                onClick={() => window.open(`${getApiBaseUrl()}/api/docs/${activeDoc.doc_id}/export/html`)}
              >
                Export HTML
              </button>
              <button
                className="tool-btn"
                onClick={() => window.open(`${getApiBaseUrl()}/api/docs/${activeDoc.doc_id}/export/txt`)}
              >
                Export TXT
              </button>
              <button
                className="tool-btn"
                onClick={() => window.open(`${getApiBaseUrl()}/api/docs/${activeDoc.doc_id}/export/png`)}
              >
                Export Images (ZIP)
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const res = await pdfApi.extractTablesJson(activeDoc.doc_id);
                  setExtractedTables({ tables: res.tables, csv_text: res.csv_text });
                  notify(`Extracted ${res.tables_count} table(s).`);
                }}
              >
                <FileSpreadsheet size={14} /> Extract Tables (XLSX/CSV)
              </button>
              <button className="tool-btn" onClick={() => docxConvertInputRef.current?.click()}>
                DOCX → PDF
              </button>
              <button className="tool-btn" onClick={() => imagesConvertInputRef.current?.click()}>
                Images → PDF
              </button>
            </>
          )}

          {mode === 'security' && activeDoc && (
            <>
              <button
                className={`tool-btn danger ${subTool === 'redact-box' ? 'active' : ''}`}
                onClick={() => setSubTool('redact-box')}
              >
                <ShieldAlert size={14} /> Redact Area (Drag on Page)
              </button>
              <button
                className="tool-btn danger"
                onClick={async () => {
                  const terms = redactSearchTerms
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const res = await pdfApi.redactPdf(activeDoc.doc_id, {
                    search_terms: terms,
                    regex_pattern: redactRegex || undefined,
                    overlay_text: redactOverlayLabel,
                  });
                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                  notify(`Permanently purged ${res.redacted_regions_count} matching region(s) across PDF streams.`);
                }}
              >
                Search & Permanently Redact
              </button>
              <div className="toolbar-divider" />
              <button
                className="tool-btn"
                onClick={async () => {
                  const res = await pdfApi.sanitizePdf(activeDoc.doc_id);
                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                  notify('Scrubbed XMP, Document Info, thumbnails, and JavaScript metadata.');
                }}
              >
                Sanitize Hidden Metadata
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const res = await pdfApi.optimizePdf(activeDoc.doc_id, {
                    image_quality: 75,
                    max_image_dimension: 1400,
                    linearize: false,
                  });
                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                  notify(
                    `Optimized PDF: ${res.original_size_bytes}B → ${res.optimized_size_bytes}B (${res.savings_percent}% saved)`
                  );
                }}
              >
                Compress & Optimize
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const res = await pdfApi.repairPdf(activeDoc.doc_id);
                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                  notify(`PDF Repair: ${res.diagnostics.join(' ')}`);
                }}
              >
                <Wrench size={14} /> Repair PDF
              </button>
              {activeDoc.is_encrypted && (
                <button
                  className="tool-btn danger"
                  onClick={async () => {
                    try {
                      const res = await pdfApi.decryptPdf(activeDoc.doc_id, '');
                      await refreshDocState(activeDoc.doc_id, currentPage, res);
                      notify('Removed password encryption from this document.');
                    } catch (err: any) {
                      notify(`Failed to decrypt document: ${err?.message || err}`, 'warn');
                    }
                  }}
                >
                  <KeyRound size={14} /> Remove Encryption
                </button>
              )}
            </>
          )}

          {mode === 'pro' && activeDoc && (
            <>
              <button
                className="tool-btn"
                onClick={async () => {
                  const s = await pdfApi.applyWatermark(activeDoc.doc_id, {
                    text: watermarkText,
                    opacity: watermarkOpacity,
                    rotation: watermarkRotation,
                  });
                  await refreshDocState(activeDoc.doc_id, currentPage, s);
                  notify(`Applied "${watermarkText}" watermark.`);
                }}
              >
                Apply Watermark
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const s = await pdfApi.applyHeaderFooter(activeDoc.doc_id, {
                    header_center: headerCenter,
                    footer_center: footerCenter,
                  });
                  await refreshDocState(activeDoc.doc_id, currentPage, s);
                  notify('Applied dynamic Headers & Footers.');
                }}
              >
                Apply Header & Footer
              </button>
              <button
                className="tool-btn"
                onClick={async () => {
                  const res = await pdfApi.applyBates(activeDoc.doc_id, {
                    prefix: batesPrefix,
                    start_number: batesStart,
                    digits: 6,
                  });
                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                  notify(`Stamped Bates numbers: ${res.first_bates} .. ${res.last_bates}`);
                }}
              >
                Stamp Bates Numbers
              </button>
              <div className="toolbar-divider" />
              <button
                className="tool-btn"
                onClick={async () => {
                  const rep = await pdfApi.runPreflight(activeDoc.doc_id);
                  setPreflightReport(rep);
                  notify(`Preflight & Accessibility Score: ${rep.score}%`);
                }}
              >
                Accessibility & Preflight
              </button>
              <button
                className="tool-btn primary"
                onClick={async () => {
                  const res = await pdfApi.convertPdfA(activeDoc.doc_id, '2B', 'en-US', activeDoc.filename);
                  setPreflightReport(res.inspection);
                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                  notify(`Converted to archival PDF/A-${res.pdfa_conformance} (Score: ${res.preflight_score}%).`);
                }}
              >
                Convert to PDF/A-2b
              </button>
            </>
          )}
        </div>
      </div>

      {/* STATUS / FALLBACK NOTIFICATION BANNER */}
      {statusBanner && (
        <div className={`notice-banner ${statusBanner.kind === 'warn' ? 'warn' : ''}`}>
          <span>{statusBanner.text}</span>
          <button
            className="menu-trigger"
            onClick={() => setStatusBanner(null)}
            style={{ padding: '2px 6px' }}
          >
            Dismiss ×
          </button>
        </div>
      )}

      {/* 4. MAIN WORKSPACE BODY */}
      <div className="workspace-body">
        {/* LEFT SIDEBAR */}
        {leftOpen && (
          <aside className="left-sidebar">
            <div className="left-rail">
              <button
                className={`rail-btn ${leftTab === 'thumbnails' ? 'active' : ''}`}
                onClick={() => setLeftTab('thumbnails')}
                title="Page Thumbnails (Drag & Drop Reorder)"
              >
                <Layers size={16} />
              </button>
              <button
                className={`rail-btn ${leftTab === 'bookmarks' ? 'active' : ''}`}
                onClick={() => setLeftTab('bookmarks')}
                title="Bookmarks / Outline"
              >
                <Bookmark size={16} />
              </button>
              <button
                className={`rail-btn ${leftTab === 'comments' ? 'active' : ''}`}
                onClick={() => setLeftTab('comments')}
                title="Annotations & Review Comments"
              >
                <MessageSquare size={16} />
              </button>
              <button
                className={`rail-btn ${leftTab === 'attachments' ? 'active' : ''}`}
                onClick={() => setLeftTab('attachments')}
                title="Embedded Attachments"
              >
                <Paperclip size={16} />
              </button>
              <button
                className={`rail-btn ${leftTab === 'fonts' ? 'active' : ''}`}
                onClick={async () => {
                  setLeftTab('fonts');
                  if (activeDoc) {
                    const fl = await pdfApi.getFonts(activeDoc.doc_id);
                    setFontsList(fl);
                  }
                }}
                title="Embedded PDF Fonts"
              >
                <Type size={16} />
              </button>
            </div>

            <div className="left-panel-content">
              {leftTab === 'thumbnails' && (
                <>
                  <div className="panel-header">
                    <span>Pages ({thumbnails.length}) — Drag to Reorder</span>
                  </div>
                  <div className="panel-scroll">
                    {thumbnails.map((t, idx) => (
                      <div
                        key={t.page_index}
                        className={`thumb-card ${t.page_index === currentPage ? 'active' : ''}`}
                        draggable
                        onDragStart={() => setDragThumbIdx(idx)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={async () => {
                          if (dragThumbIdx === null || dragThumbIdx === idx || !activeDoc) return;
                          const order = thumbnails.map((item) => item.page_index);
                          const [moved] = order.splice(dragThumbIdx, 1);
                          order.splice(idx, 0, moved);
                          setDragThumbIdx(null);
                          const s = await pdfApi.reorderPages(activeDoc.doc_id, order);
                          await refreshDocState(activeDoc.doc_id, idx, s);
                          notify(`Reordered page ${dragThumbIdx + 1} → ${idx + 1}.`);
                        }}
                        onClick={() => setCurrentPage(t.page_index)}
                      >
                        <img
                          src={`data:image/png;base64,${t.image_base64}`}
                          alt={`Page ${t.page_number}`}
                        />
                        <div className="thumb-meta">
                          <span>Page {t.page_number}</span>
                          <span>
                            {Math.round(t.width_pt)}×{Math.round(t.height_pt)}pt
                            {t.rotation ? ` (${t.rotation}°)` : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {leftTab === 'bookmarks' && (
                <>
                  <div className="panel-header">
                    <span>Bookmarks ({bookmarks.length})</span>
                  </div>
                  <div className="panel-scroll">
                    <div className="form-row" style={{ marginBottom: 10 }}>
                      <input
                        type="text"
                        placeholder="Bookmark title..."
                        value={newBookmarkTitle}
                        onChange={(e) => setNewBookmarkTitle(e.target.value)}
                      />
                      <button
                        className="tool-btn primary"
                        style={{ flex: '0 0 auto' }}
                        onClick={async () => {
                          if (!activeDoc) return;
                          const res = await pdfApi.addBookmark(
                            activeDoc.doc_id,
                            newBookmarkTitle || `Page ${currentPage + 1}`,
                            currentPage,
                            1
                          );
                          setNewBookmarkTitle('');
                          setBookmarks(res.bookmarks);
                          notify('Added bookmark.');
                        }}
                      >
                        + Add
                      </button>
                    </div>
                    {bookmarks.map((bm) => (
                      <div
                        key={bm.index}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 8px',
                          paddingLeft: `${(bm.level - 1) * 14 + 8}px`,
                          borderBottom: '1px solid var(--border-color)',
                          cursor: 'pointer',
                        }}
                        onClick={() => setCurrentPage(bm.page_index)}
                      >
                        <span style={{ fontSize: 12 }}>{bm.title}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="badge pass">p.{bm.page_number}</span>
                          <button
                            className="tab-close"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!activeDoc) return;
                              const res = await pdfApi.deleteBookmark(activeDoc.doc_id, bm.index);
                              setBookmarks(res.bookmarks);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {leftTab === 'comments' && (
                <>
                  <div className="panel-header">
                    <span>Review Comments ({annotations.length})</span>
                  </div>
                  <div className="panel-scroll">
                    {annotations.length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                        No annotations yet. Switch to Annotate mode to add highlights, notes, or stamps.
                      </p>
                    )}
                    {annotations.map((an) => (
                      <div
                        key={an.xref}
                        className="inspector-section"
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setCurrentPage(an.page_index);
                          setSelectedAnnot(an);
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <strong>{an.type}</strong>
                          <span className="badge warn">Page {an.page_number}</span>
                        </div>
                        <div style={{ fontSize: 12, marginBottom: 4 }}>{an.content || '(No text)'}</div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 11,
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <span>By {an.author}</span>
                          <button
                            className="tab-close"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!activeDoc) return;
                              const res = await pdfApi.deleteAnnotation(
                                activeDoc.doc_id,
                                an.xref,
                                an.page_index
                              );
                              setAnnotations(res.annotations);
                              await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {leftTab === 'attachments' && (
                <>
                  <div className="panel-header">
                    <span>Attachments ({attachments.length})</span>
                    <button className="tool-btn" onClick={() => attachmentInputRef.current?.click()}>
                      + Attach
                    </button>
                  </div>
                  <div className="panel-scroll">
                    {attachments.map((at) => (
                      <div key={at.name} className="inspector-section">
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{at.filename}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                          {at.size_bytes} bytes
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <a
                            className="tool-btn"
                            href={`${getApiBaseUrl()}/api/docs/${activeDoc?.doc_id}/attachments/${encodeURIComponent(
                              at.name
                            )}`}
                            download={at.filename}
                            style={{ textDecoration: 'none' }}
                          >
                            <Download size={12} /> Extract
                          </a>
                          <button
                            className="tool-btn danger"
                            onClick={async () => {
                              if (!activeDoc) return;
                              const res = await pdfApi.deleteAttachment(activeDoc.doc_id, at.name);
                              setAttachments(res.attachments);
                            }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {leftTab === 'fonts' && (
                <>
                  <div className="panel-header">
                    <span>Embedded PDF Fonts ({fontsList.length})</span>
                  </div>
                  <div className="panel-scroll">
                    {fontsList.map((f, idx) => (
                      <div key={`${f.xref}_${idx}`} className="inspector-section">
                        <div style={{ fontWeight: 600, fontSize: 12, wordBreak: 'break-all' }}>{f.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                          Type: {f.type} | Enc: {f.encoding}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <span className={`badge ${f.is_embedded ? 'pass' : 'warn'}`}>
                            {f.is_embedded ? 'Embedded' : 'Standard Base-14'}
                          </span>
                          {f.is_subset && <span className="badge warn">Subset</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </aside>
        )}

        {/* CENTRAL PDF CANVAS WORKSPACE */}
        <main className="canvas-viewport">
          {activeDoc && pageBitmap ? (
            <div
              className="pdf-page-stage"
              style={{
                width: `${pageSizePt.width * zoom}px`,
                height: `${pageSizePt.height * zoom}px`,
                cursor: subTool === 'select' ? 'default' : 'crosshair',
              }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
            >
              <img className="page-bitmap" src={pageBitmap} alt={`Page ${currentPage + 1}`} />

              {/* INTERACTIVE OVERLAY LAYER */}
              <div className="interactive-overlay">
                {/* Search Highlight Hits */}
                {pageSearchHits.map((hit, idx) => (
                  <div
                    key={idx}
                    className="search-hit-box"
                    style={{
                      left: `${hit.bbox[0] * zoom}px`,
                      top: `${hit.bbox[1] * zoom}px`,
                      width: `${(hit.bbox[2] - hit.bbox[0]) * zoom}px`,
                      height: `${(hit.bbox[3] - hit.bbox[1]) * zoom}px`,
                    }}
                  />
                ))}

                {/* Vellum Text Boxes (Interactive Move/Resize/Edit) */}
                {mode === 'edit' &&
                  subTool === 'select' &&
                  pageObjects?.vellum_boxes?.map((box) => (
                    <div
                      key={box.id}
                      className={`vellum-box-overlay ${selectedObj?.objectId === box.id ? 'active-selected' : ''}`}
                      style={{
                        left: `${box.bbox[0] * zoom}px`,
                        top: `${box.bbox[1] * zoom}px`,
                        width: `${Math.max(12, (box.bbox[2] - box.bbox[0]) * zoom)}px`,
                        height: `${Math.max(10, (box.bbox[3] - box.bbox[1]) * zoom)}px`,
                      }}
                      title={`Text Box: "${box.text}" (Click to select/drag, Double-click to edit)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectManipulableObject('textbox', box.id, box.bbox, box);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        handleStartEditText(box);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectManipulableObject('textbox', box.id, box.bbox, box);
                        setContextMenuPos({ x: e.clientX, y: e.clientY });
                      }}
                    />
                  ))}

                {/* Vellum Vector Shapes (Interactive Move/Resize) */}
                {mode === 'edit' &&
                  subTool === 'select' &&
                  pageObjects?.vellum_shapes?.map((shape) => (
                    <div
                      key={shape.id}
                      className={`vellum-shape-overlay ${selectedObj?.objectId === shape.id ? 'active-selected' : ''}`}
                      style={{
                        left: `${Math.min(shape.bbox[0], shape.bbox[2]) * zoom}px`,
                        top: `${Math.min(shape.bbox[1], shape.bbox[3]) * zoom}px`,
                        width: `${Math.max(12, Math.abs(shape.bbox[2] - shape.bbox[0]) * zoom)}px`,
                        height: `${Math.max(10, Math.abs(shape.bbox[3] - shape.bbox[1]) * zoom)}px`,
                      }}
                      title={`Vector Shape: ${shape.shape_type} (Click to select/drag/resize)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectManipulableObject('shape', shape.id, shape.bbox, shape);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectManipulableObject('shape', shape.id, shape.bbox, shape);
                        setContextMenuPos({ x: e.clientX, y: e.clientY });
                      }}
                    />
                  ))}

                {/* Direct PDF Text Spans & Images Overlay (Active in Edit Mode) */}
                {mode === 'edit' &&
                  subTool === 'select' &&
                  pageObjects?.text_spans.map((sp) => (
                    <div
                      key={sp.id}
                      className={`span-box ${selectedObj?.objectId === sp.id ? 'selected' : ''}`}
                      style={{
                        left: `${sp.bbox[0] * zoom}px`,
                        top: `${sp.bbox[1] * zoom}px`,
                        width: `${Math.max(12, (sp.bbox[2] - sp.bbox[0]) * zoom)}px`,
                        height: `${Math.max(10, (sp.bbox[3] - sp.bbox[1]) * zoom)}px`,
                      }}
                      title={`Click to select/move span · Double-click to edit paragraph: "${sp.text}" (${sp.font}, ${sp.size}pt)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectManipulableObject('text_span', sp.id, sp.bbox, sp);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        openParagraphEditorForSpan(sp);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectManipulableObject('text_span', sp.id, sp.bbox, sp);
                        setContextMenuPos({ x: e.clientX, y: e.clientY });
                      }}
                    />
                  ))}

                {mode === 'edit' &&
                  subTool === 'select' &&
                  pageObjects?.images.map((im) => (
                    <div
                      key={im.id}
                      className={`image-box ${selectedObj?.objectId === im.id ? 'selected' : ''}`}
                      style={{
                        left: `${im.bbox[0] * zoom}px`,
                        top: `${im.bbox[1] * zoom}px`,
                        width: `${Math.max(16, (im.bbox[2] - im.bbox[0]) * zoom)}px`,
                        height: `${Math.max(16, (im.bbox[3] - im.bbox[1]) * zoom)}px`,
                      }}
                      title={`Click to transform/replace/delete embedded PDF image (xref=${im.xref}, ${im.width}×${im.height}px)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectManipulableObject('image', im.id, im.bbox, im);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        selectManipulableObject('image', im.id, im.bbox, im);
                        setContextMenuPos({ x: e.clientX, y: e.clientY });
                      }}
                    />
                  ))}

                {/* Annotations Overlay */}
                {mode === 'annotate' &&
                  subTool === 'select' &&
                  pageAnnotations.map((an) => (
                    <div
                      key={an.xref}
                      className={`annot-box ${selectedAnnot?.xref === an.xref ? 'selected' : ''}`}
                      style={{
                        left: `${an.bbox[0] * zoom}px`,
                        top: `${an.bbox[1] * zoom}px`,
                        width: `${Math.max(18, (an.bbox[2] - an.bbox[0]) * zoom)}px`,
                        height: `${Math.max(18, (an.bbox[3] - an.bbox[1]) * zoom)}px`,
                      }}
                      title={`${an.type}: ${an.content}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedAnnot(an);
                      }}
                    />
                  ))}

                {/* Interactive AcroForm Widgets Overlay */}
                {(mode === 'forms' || mode === 'view') &&
                  subTool === 'select' &&
                  [...pageFormFields]
                    .sort((a, b) => (a.tab_order ?? 0) - (b.tab_order ?? 0))
                    .map((fld, idx, sortedArr) => {
                      const handleFieldTabNav = (e: React.KeyboardEvent) => {
                        if (e.key === 'Tab') {
                          e.preventDefault();
                          const nextIdx = e.shiftKey
                            ? (idx - 1 + sortedArr.length) % sortedArr.length
                            : (idx + 1) % sortedArr.length;
                          const nextFld = sortedArr[nextIdx];
                          if (nextFld) {
                            setSelectedField(nextFld);
                            formWidgetRefs.current[nextFld.xref]?.focus();
                          }
                        }
                      };
                      const fieldTextColor = fld.text_color || '#000000';
                      const fieldFontSize = Math.max(
                        9,
                        (fld.text_fontsize && fld.text_fontsize > 0 ? fld.text_fontsize : 11) * zoom * 0.9
                      );
                      const fieldAlign = (fld.align as 'left' | 'center' | 'right') || 'left';
                      const draftVal =
                        formDraftValues[String(fld.xref)] !== undefined
                          ? formDraftValues[String(fld.xref)]
                          : formDraftValues[fld.field_name] ?? fld.value;

                      return (
                        <div
                          key={fld.xref}
                          className={`form-widget-box ${selectedField?.xref === fld.xref ? 'selected' : ''}`}
                          title={`${fld.field_label || fld.field_name}${fld.required ? ' (Required)' : ''}${fld.read_only ? ' (Read-Only)' : ''}`}
                          style={{
                            left: `${fld.bbox[0] * zoom}px`,
                            top: `${fld.bbox[1] * zoom}px`,
                            width: `${Math.max(18, (fld.bbox[2] - fld.bbox[0]) * zoom)}px`,
                            height: `${Math.max(16, (fld.bbox[3] - fld.bbox[1]) * zoom)}px`,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedField(fld);
                          }}
                        >
                          {fld.field_type === 'checkbox' ? (
                            <input
                              ref={(el) => {
                                formWidgetRefs.current[fld.xref] = el;
                              }}
                              type="checkbox"
                              disabled={fld.read_only}
                              checked={Boolean(draftVal)}
                              onKeyDown={handleFieldTabNav}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setFormDraftValues((prev) => ({
                                  ...prev,
                                  [fld.field_name]: checked,
                                  [String(fld.xref)]: checked,
                                }));
                              }}
                              style={{ width: '100%', height: '100%', cursor: fld.read_only ? 'not-allowed' : 'pointer' }}
                            />
                          ) : fld.field_type === 'radiobutton' ? (
                            <input
                              ref={(el) => {
                                formWidgetRefs.current[fld.xref] = el;
                              }}
                              type="radio"
                              name={`vellum_radio_${fld.field_name}`}
                              disabled={fld.read_only}
                              checked={Boolean(formDraftValues[String(fld.xref)])}
                              onKeyDown={handleFieldTabNav}
                              onChange={() => {
                                const expVal = fld.export_value || 'Yes';
                                setFormDraftValues((prev) => {
                                  const next = { ...prev, [fld.field_name]: expVal };
                                  formFields
                                    .filter((other) => other.field_name === fld.field_name && other.field_type === 'radiobutton')
                                    .forEach((other) => {
                                      next[String(other.xref)] = other.xref === fld.xref;
                                    });
                                  return next;
                                });
                              }}
                              style={{ width: '100%', height: '100%', cursor: fld.read_only ? 'not-allowed' : 'pointer' }}
                            />
                          ) : fld.field_type === 'dropdown' ? (
                            <select
                              ref={(el) => {
                                formWidgetRefs.current[fld.xref] = el;
                              }}
                              disabled={fld.read_only}
                              value={String(draftVal ?? '')}
                              onKeyDown={handleFieldTabNav}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormDraftValues((prev) => ({
                                  ...prev,
                                  [fld.field_name]: val,
                                  [String(fld.xref)]: val,
                                }));
                              }}
                              style={{ width: '100%', height: '100%', fontSize: Math.max(10, fieldFontSize), padding: 1 }}
                            >
                              {fld.choices.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          ) : fld.field_type === 'listbox' ? (
                            <select
                              ref={(el) => {
                                formWidgetRefs.current[fld.xref] = el;
                              }}
                              size={Math.min(5, Math.max(2, fld.choices.length || 3))}
                              disabled={fld.read_only}
                              value={String(draftVal ?? '')}
                              onKeyDown={handleFieldTabNav}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormDraftValues((prev) => ({
                                  ...prev,
                                  [fld.field_name]: val,
                                  [String(fld.xref)]: val,
                                }));
                              }}
                              style={{ width: '100%', height: '100%', fontSize: Math.max(10, fieldFontSize), padding: 1 }}
                            >
                              {fld.choices.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          ) : fld.multiline ? (
                            <textarea
                              ref={(el) => {
                                formWidgetRefs.current[fld.xref] = el;
                              }}
                              readOnly={fld.read_only}
                              maxLength={fld.text_maxlen && fld.text_maxlen > 0 ? fld.text_maxlen : undefined}
                              value={String(draftVal ?? '')}
                              onKeyDown={handleFieldTabNav}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormDraftValues((prev) => ({
                                  ...prev,
                                  [fld.field_name]: val,
                                  [String(fld.xref)]: val,
                                }));
                              }}
                              style={{
                                width: '100%',
                                height: '100%',
                                resize: 'none',
                                fontSize: `${fieldFontSize}px`,
                                textAlign: fieldAlign,
                                padding: '2px 4px',
                                background: 'rgba(255,255,255,0.90)',
                                color: fieldTextColor,
                                border: 'none',
                              }}
                            />
                          ) : (
                            <input
                              ref={(el) => {
                                formWidgetRefs.current[fld.xref] = el;
                              }}
                              type={fld.password_field ? 'password' : 'text'}
                              readOnly={fld.read_only}
                              maxLength={fld.text_maxlen && fld.text_maxlen > 0 ? fld.text_maxlen : undefined}
                              value={String(draftVal ?? '')}
                              onKeyDown={handleFieldTabNav}
                              onChange={(e) => {
                                const val = e.target.value;
                                setFormDraftValues((prev) => ({
                                  ...prev,
                                  [fld.field_name]: val,
                                  [String(fld.xref)]: val,
                                }));
                              }}
                              style={{
                                width: '100%',
                                height: '100%',
                                fontSize: `${fieldFontSize}px`,
                                textAlign: fieldAlign,
                                padding: '1px 4px',
                                background: 'rgba(255,255,255,0.90)',
                                color: fieldTextColor,
                                border: 'none',
                              }}
                            />
                          )}
                          {mode === 'forms' && formSubMode === 'prepare' && selectedField?.xref === fld.xref && activeDoc && (
                            <>
                              <div
                                className="form-widget-move-handle"
                                title="Drag to move form field"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const startX = e.clientX;
                                  const startY = e.clientY;
                                  const origBbox = [...fld.bbox] as [number, number, number, number];
                                  let latestBbox = origBbox;
                                  const onMove = (mv: MouseEvent) => {
                                    const dx = (mv.clientX - startX) / zoom;
                                    const dy = (mv.clientY - startY) / zoom;
                                    latestBbox = [
                                      Math.max(0, origBbox[0] + dx),
                                      Math.max(0, origBbox[1] + dy),
                                      Math.max(12, origBbox[2] + dx),
                                      Math.max(12, origBbox[3] + dy),
                                    ];
                                    setFormFields((prev) =>
                                      prev.map((item) => (item.xref === fld.xref ? { ...item, bbox: latestBbox } : item))
                                    );
                                    setSelectedField((prev) => (prev?.xref === fld.xref ? { ...prev, bbox: latestBbox } : prev));
                                  };
                                  const onUp = async () => {
                                    window.removeEventListener('mousemove', onMove);
                                    window.removeEventListener('mouseup', onUp);
                                    if (
                                      Math.abs(latestBbox[0] - origBbox[0]) > 0.5 ||
                                      Math.abs(latestBbox[1] - origBbox[1]) > 0.5
                                    ) {
                                      try {
                                        const res = await pdfApi.updateFormField(activeDoc.doc_id, fld.xref, {
                                          page_index: fld.page_index,
                                          bbox: latestBbox,
                                        });
                                        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                                        notify(`Moved field '${fld.field_name}'.`);
                                      } catch (err: any) {
                                        notify(err?.message || 'Failed to move form field.', 'warn');
                                      }
                                    }
                                  };
                                  window.addEventListener('mousemove', onMove);
                                  window.addEventListener('mouseup', onUp);
                                }}
                                style={{
                                  position: 'absolute',
                                  top: -10,
                                  left: -2,
                                  width: 14,
                                  height: 12,
                                  background: '#2563eb',
                                  color: '#fff',
                                  fontSize: 9,
                                  lineHeight: '12px',
                                  textAlign: 'center',
                                  borderRadius: 2,
                                  cursor: 'move',
                                  zIndex: 12,
                                }}
                              >
                                ✥
                              </div>
                              <div
                                className="form-widget-resize-handle"
                                title="Drag to resize form field"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                  const startX = e.clientX;
                                  const startY = e.clientY;
                                  const origBbox = [...fld.bbox] as [number, number, number, number];
                                  let latestBbox = origBbox;
                                  const onMove = (mv: MouseEvent) => {
                                    const dx = (mv.clientX - startX) / zoom;
                                    const dy = (mv.clientY - startY) / zoom;
                                    latestBbox = [
                                      origBbox[0],
                                      origBbox[1],
                                      Math.max(origBbox[0] + 14, origBbox[2] + dx),
                                      Math.max(origBbox[1] + 12, origBbox[3] + dy),
                                    ];
                                    setFormFields((prev) =>
                                      prev.map((item) => (item.xref === fld.xref ? { ...item, bbox: latestBbox } : item))
                                    );
                                    setSelectedField((prev) => (prev?.xref === fld.xref ? { ...prev, bbox: latestBbox } : prev));
                                  };
                                  const onUp = async () => {
                                    window.removeEventListener('mousemove', onMove);
                                    window.removeEventListener('mouseup', onUp);
                                    if (
                                      Math.abs(latestBbox[2] - origBbox[2]) > 0.5 ||
                                      Math.abs(latestBbox[3] - origBbox[3]) > 0.5
                                    ) {
                                      try {
                                        const res = await pdfApi.updateFormField(activeDoc.doc_id, fld.xref, {
                                          page_index: fld.page_index,
                                          bbox: latestBbox,
                                        });
                                        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                                        notify(`Resized field '${fld.field_name}'.`);
                                      } catch (err: any) {
                                        notify(err?.message || 'Failed to resize form field.', 'warn');
                                      }
                                    }
                                  };
                                  window.addEventListener('mousemove', onMove);
                                  window.addEventListener('mouseup', onUp);
                                }}
                                style={{
                                  position: 'absolute',
                                  right: -4,
                                  bottom: -4,
                                  width: 10,
                                  height: 10,
                                  background: '#2563eb',
                                  border: '1px solid #fff',
                                  borderRadius: 2,
                                  cursor: 'nwse-resize',
                                  zIndex: 12,
                                }}
                              />
                            </>
                          )}
                        </div>
                      );
                    })}

                {/* Detected Form Field Candidates Overlay */}
                {mode === 'forms' &&
                  formSubMode === 'prepare' &&
                  formCandidates
                    .filter((c) => c.page_index === currentPage)
                    .map((cand) => {
                      const isAccepted = cand.accepted !== false;
                      return (
                        <div
                          key={cand.id}
                          className={`form-candidate-box ${isAccepted ? 'accepted' : 'rejected'}`}
                          title={`${cand.field_name} (${cand.field_type}) — Click to ${isAccepted ? 'reject' : 'accept'}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setFormCandidates((prev) =>
                              prev.map((c) => (c.id === cand.id ? { ...c, accepted: !isAccepted } : c))
                            );
                          }}
                          style={{
                            position: 'absolute',
                            left: `${cand.bbox[0] * zoom}px`,
                            top: `${cand.bbox[1] * zoom}px`,
                            width: `${Math.max(14, (cand.bbox[2] - cand.bbox[0]) * zoom)}px`,
                            height: `${Math.max(12, (cand.bbox[3] - cand.bbox[1]) * zoom)}px`,
                            border: isAccepted ? '2px dashed #16a34a' : '2px dashed #94a3b8',
                            background: isAccepted ? 'rgba(22, 163, 74, 0.14)' : 'rgba(148, 163, 184, 0.10)',
                            cursor: 'pointer',
                            zIndex: 9,
                            boxSizing: 'border-box',
                          }}
                        >
                          <div
                            className="form-candidate-resize-handle"
                            title="Drag to adjust candidate boundary"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const startX = e.clientX;
                              const startY = e.clientY;
                              const origBbox = [...cand.bbox] as [number, number, number, number];
                              const onMove = (mv: MouseEvent) => {
                                const dx = (mv.clientX - startX) / zoom;
                                const dy = (mv.clientY - startY) / zoom;
                                const nextBbox: [number, number, number, number] = [
                                  origBbox[0],
                                  origBbox[1],
                                  Math.max(origBbox[0] + 12, origBbox[2] + dx),
                                  Math.max(origBbox[1] + 10, origBbox[3] + dy),
                                ];
                                setFormCandidates((prev) =>
                                  prev.map((c) => (c.id === cand.id ? { ...c, bbox: nextBbox } : c))
                                );
                              };
                              const onUp = () => {
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                              };
                              window.addEventListener('mousemove', onMove);
                              window.addEventListener('mouseup', onUp);
                            }}
                            style={{
                              position: 'absolute',
                              right: -4,
                              bottom: -4,
                              width: 8,
                              height: 8,
                              background: isAccepted ? '#16a34a' : '#64748b',
                              border: '1px solid #fff',
                              borderRadius: 2,
                              cursor: 'nwse-resize',
                            }}
                          />
                        </div>
                      );
                    })}

                {/* Active Rubber-Band Selection Box */}
                {dragStart && dragCurrent && (
                  <div
                    className="rubberband-box"
                    style={{
                      left: `${Math.min(dragStart.x, dragCurrent.x) * zoom}px`,
                      top: `${Math.min(dragStart.y, dragCurrent.y) * zoom}px`,
                      width: `${Math.abs(dragCurrent.x - dragStart.x) * zoom}px`,
                      height: `${Math.abs(dragCurrent.y - dragStart.y) * zoom}px`,
                    }}
                  />
                )}

                {/* Active Inline Text Box Overlay */}
                {draftTextBox && (
                  <div
                    className="inline-textbox-overlay"
                    style={{
                      left: `${draftTextBox.bbox[0] * zoom}px`,
                      top: `${draftTextBox.bbox[1] * zoom}px`,
                      width: `${Math.max(120, (draftTextBox.bbox[2] - draftTextBox.bbox[0]) * zoom)}px`,
                      height: `${Math.max(48, (draftTextBox.bbox[3] - draftTextBox.bbox[1]) * zoom)}px`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="inline-textbox-toolbar">
                      <button
                        type="button"
                        className="mini-btn apply"
                        onClick={handleCommitDraftTextBox}
                        title="Insert Text into PDF (Ctrl+Enter)"
                      >
                        <Check size={12} /> Insert
                      </button>
                      <button
                        type="button"
                        className="mini-btn cancel"
                        onClick={handleCancelDraftTextBox}
                        title="Cancel (Esc)"
                      >
                        <X size={12} /> Cancel
                      </button>
                      <span className="mini-hint">Ctrl+Enter to insert · Esc to cancel</span>
                    </div>
                    <textarea
                      ref={draftTextAreaRef}
                      className="inline-textbox-input"
                      value={draftTextBox.text}
                      placeholder="Type text directly on page..."
                      onChange={(e) =>
                        setDraftTextBox((prev) => (prev ? { ...prev, text: e.target.value } : null))
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleCommitDraftTextBox();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          handleCancelDraftTextBox();
                        }
                      }}
                      style={{
                        fontFamily:
                          draftTextBox.font === 'tiro'
                            ? 'serif'
                            : draftTextBox.font === 'cour'
                            ? 'monospace'
                            : 'sans-serif',
                        fontSize: `${Math.max(10, draftTextBox.size * zoom)}px`,
                        color: draftTextBox.color,
                        fontWeight: draftTextBox.bold ? 700 : 400,
                        fontStyle: draftTextBox.italic ? 'italic' : 'normal',
                        textAlign: draftTextBox.align,
                      }}
                      autoFocus
                    />
                  </div>
                )}

                {/* Paragraph Block Hitboxes (Active in Edit Paragraph Tool) */}
                {mode === 'edit' &&
                  subTool === 'edit-paragraph' &&
                  !draftParagraph &&
                  pageObjects?.text_blocks?.map((blk) => (
                    <div
                      key={blk.id}
                      className="paragraph-box-overlay"
                      style={{
                        left: `${blk.bbox[0] * zoom}px`,
                        top: `${blk.bbox[1] * zoom}px`,
                        width: `${Math.max(24, (blk.bbox[2] - blk.bbox[0]) * zoom)}px`,
                        height: `${Math.max(14, (blk.bbox[3] - blk.bbox[1]) * zoom)}px`,
                      }}
                      title={`Click to edit & reflow paragraph (${blk.dominant_font || 'Font'}, ${blk.dominant_size || 12}pt)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openParagraphEditorForBlock(blk);
                      }}
                    />
                  ))}

                {/* Active Acrobat-Style Inline Paragraph Editor Overlay */}
                {draftParagraph && (() => {
                  const fallbackRun: TextRun = {
                    text: '',
                    font: draftParagraph.font,
                    size: draftParagraph.size,
                    color: draftParagraph.color,
                    bold: draftParagraph.bold,
                    italic: draftParagraph.italic,
                  };
                  const selStyle = getSelectionStyle(
                    draftParagraph.runs,
                    draftParagraph.selectionRange.start,
                    draftParagraph.selectionRange.end,
                    fallbackRun
                  );
                  return (
                  <div
                    className={`inline-paragraph-overlay ${isLightHexColor(draftParagraph.color) ? 'dark-paper' : 'light-paper'}`}
                    style={{
                      left: `${draftParagraph.targetBbox[0] * zoom}px`,
                      top: `${draftParagraph.targetBbox[1] * zoom}px`,
                      width: `${Math.max(140, (draftParagraph.targetBbox[2] - draftParagraph.targetBbox[0]) * zoom)}px`,
                      minHeight: `${Math.max(24, (draftParagraph.targetBbox[3] - draftParagraph.targetBbox[1]) * zoom)}px`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <div
                      className={`inline-textbox-toolbar inline-paragraph-floating-toolbar ${
                        draftParagraph.targetBbox[1] * zoom < 44 ? 'place-below' : 'place-above'
                      }`}
                    >
                      <button
                        type="button"
                        className="mini-btn apply"
                        disabled={isCommittingParagraph}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleCommitDraftParagraph('check')}
                        title="Save & Reflow Paragraph (Ctrl+Enter)"
                      >
                        <Check size={12} /> {isCommittingParagraph ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="mini-btn cancel"
                        disabled={isCommittingParagraph}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={handleCancelDraftParagraph}
                        title="Cancel (Esc)"
                      >
                        <X size={12} /> Cancel
                      </button>
                      <span className="rich-fmt-sep" />
                      <button
                        type="button"
                        className={`rich-fmt-btn ${selStyle.bold ? 'active' : ''}`}
                        title="Bold selection (Ctrl+B)"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyParagraphStylePatch({ bold: !selStyle.bold })}
                      >
                        <strong>B</strong>
                      </button>
                      <button
                        type="button"
                        className={`rich-fmt-btn ${selStyle.italic ? 'active' : ''}`}
                        title="Italic selection (Ctrl+I)"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyParagraphStylePatch({ italic: !selStyle.italic })}
                      >
                        <em>I</em>
                      </button>
                      <input
                        type="number"
                        className="rich-fmt-size"
                        title="Font size (pt)"
                        min={6}
                        max={96}
                        step={0.5}
                        value={selStyle.size}
                        onChange={(e) =>
                          applyParagraphStylePatch({ size: Math.max(6, Number(e.target.value) || 12) })
                        }
                      />
                      <input
                        type="color"
                        className="rich-fmt-color"
                        title="Text color"
                        value={selStyle.color}
                        onChange={(e) => applyParagraphStylePatch({ color: e.target.value })}
                      />
                      <select
                        className="rich-fmt-font"
                        title="Font family"
                        value={selStyle.font}
                        onChange={(e) => applyParagraphStylePatch({ font: e.target.value })}
                      >
                        <option value={draftParagraph.originalFont}>{draftParagraph.originalFont}</option>
                        <option value="helv">Helvetica</option>
                        <option value="tiro">Times</option>
                        <option value="cour">Courier</option>
                        <option value="dejavu">DejaVu Sans</option>
                      </select>
                      <span className="mini-hint">
                        {Math.round(draftParagraph.targetBbox[2] - draftParagraph.targetBbox[0])} ×{' '}
                        {Math.round(draftParagraph.targetBbox[3] - draftParagraph.targetBbox[1])} pt · Ctrl+Enter
                      </span>
                    </div>

                    {draftParagraph.hasSubsetFont && (
                      <div className="paragraph-font-warning">
                        Embedded/subset font ({draftParagraph.originalFont}) detected — unencoded glyphs will use fallback font with warning.
                      </div>
                    )}

                    {draftParagraph.overflowInfo && (
                      <div className="paragraph-overflow-banner">
                        <div className="paragraph-overflow-msg">
                          <AlertTriangle size={13} />
                          <span>
                            {draftParagraph.overflowInfo.message || (
                              <>
                                Overflow: requires {draftParagraph.overflowInfo.required_height} pt height (box has{' '}
                                {draftParagraph.overflowInfo.available_height} pt).
                                {draftParagraph.overflowInfo.collides_with_neighbors
                                  ? ' Expanding further would overlap neighboring content.'
                                  : ''}
                              </>
                            )}
                          </span>
                        </div>
                        <div className="paragraph-overflow-actions">
                          {draftParagraph.overflowInfo.can_expand_safely && (
                            <button
                              type="button"
                              className="mini-btn apply"
                              onClick={() => handleCommitDraftParagraph('expand_box')}
                            >
                              Expand Box ({draftParagraph.overflowInfo.required_height} pt)
                            </button>
                          )}
                          {draftParagraph.overflowInfo.suggested_font_size && (
                            <button
                              type="button"
                              className="mini-btn apply"
                              onClick={() => handleCommitDraftParagraph('shrink_font')}
                            >
                              Fit Font ({draftParagraph.overflowInfo.suggested_font_size} pt)
                            </button>
                          )}
                          <button
                            type="button"
                            className="mini-btn cancel"
                            onClick={() =>
                              setDraftParagraph((prev) => (prev ? { ...prev, overflowInfo: null } : null))
                            }
                          >
                            Keep Editing
                          </button>
                        </div>
                      </div>
                    )}

                    <div
                      ref={draftParagraphRef}
                      className="inline-paragraph-input inline-paragraph-richtext"
                      contentEditable
                      suppressContentEditableWarning
                      spellCheck={false}
                      role="textbox"
                      aria-multiline="true"
                      aria-label="Rich inline paragraph editor"
                      onInput={(e) => {
                        const el = e.currentTarget;
                        const nextRuns = parseDomToRuns(el, fallbackRun);
                        const nextText = nextRuns.map((r) => r.text).join('');
                        const sel = getDomSelectionOffsets(el);
                        setDraftParagraph((prev) =>
                          prev
                            ? {
                                ...prev,
                                text: nextText,
                                runs: nextRuns,
                                selectionRange: sel,
                                overflowInfo: null,
                              }
                            : null
                        );
                      }}
                      onKeyUp={(e) => {
                        const sel = getDomSelectionOffsets(e.currentTarget);
                        setDraftParagraph((prev) =>
                          prev ? { ...prev, selectionRange: sel } : null
                        );
                      }}
                      onMouseUp={(e) => {
                        const sel = getDomSelectionOffsets(e.currentTarget);
                        setDraftParagraph((prev) =>
                          prev ? { ...prev, selectionRange: sel } : null
                        );
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const plain = e.clipboardData.getData('text/plain');
                        document.execCommand('insertText', false, plain);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          handleCommitDraftParagraph('check');
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          handleCancelDraftParagraph();
                        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                          e.preventDefault();
                          applyParagraphStylePatch({ bold: !selStyle.bold });
                        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
                          e.preventDefault();
                          applyParagraphStylePatch({ italic: !selStyle.italic });
                        }
                      }}
                      style={{
                        fontFamily: mapPdfFontToCss(draftParagraph.font),
                        fontSize: `${Math.max(9, draftParagraph.size * zoom)}px`,
                        lineHeight: draftParagraph.lineHeight,
                        color: draftParagraph.color,
                        textAlign: draftParagraph.align,
                        minHeight: `${Math.max(24, (draftParagraph.targetBbox[3] - draftParagraph.targetBbox[1]) * zoom)}px`,
                      }}
                    />
                  </div>
                  );
                })()}

                {/* Unified Object Selection Frame with 8 Resize Handles */}
                {mode === 'edit' && subTool === 'select' && selectedObj && !draftTextBox && !draftParagraph && (
                  <div
                    className="object-selection-frame"
                    style={{
                      left: `${selectedObj.currentBbox[0] * zoom}px`,
                      top: `${selectedObj.currentBbox[1] * zoom}px`,
                      width: `${Math.max(10, (selectedObj.currentBbox[2] - selectedObj.currentBbox[0]) * zoom)}px`,
                      height: `${Math.max(10, (selectedObj.currentBbox[3] - selectedObj.currentBbox[1]) * zoom)}px`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenuPos({ x: e.clientX, y: e.clientY });
                    }}
                  >
                    <div
                      className="object-selection-body"
                      onMouseDown={handleStartDragMove}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (selectedObj.objectType === 'textbox') {
                          handleStartEditText(selectedObj.data);
                        } else if (selectedObj.objectType === 'text_span') {
                          openParagraphEditorForSpan(selectedObj.data);
                        }
                      }}
                      title={
                        selectedObj.objectType === 'text_span' || selectedObj.objectType === 'textbox'
                          ? 'Drag to move · Double-click to edit inline · Arrow keys to nudge · Del to remove'
                          : 'Drag to move object · Arrow keys to nudge (Shift: 10pt) · Del to remove'
                      }
                    />
                    <div className="selection-dimension-badge">
                      <span>
                        {Math.round(selectedObj.currentBbox[2] - selectedObj.currentBbox[0])} ×{' '}
                        {Math.round(selectedObj.currentBbox[3] - selectedObj.currentBbox[1])} pt
                      </span>
                      <span>
                        (X: {Math.round(selectedObj.currentBbox[0])}, Y: {Math.round(selectedObj.currentBbox[1])})
                      </span>
                    </div>
                    <div className="resize-handle handle-nw" onMouseDown={(e) => handleStartResize(e, 'nw')} onDoubleClick={(e) => e.stopPropagation()} />
                    <div className="resize-handle handle-n" onMouseDown={(e) => handleStartResize(e, 'n')} onDoubleClick={(e) => e.stopPropagation()} />
                    <div className="resize-handle handle-ne" onMouseDown={(e) => handleStartResize(e, 'ne')} onDoubleClick={(e) => e.stopPropagation()} />
                    <div className="resize-handle handle-e" onMouseDown={(e) => handleStartResize(e, 'e')} onDoubleClick={(e) => e.stopPropagation()} />
                    <div className="resize-handle handle-se" onMouseDown={(e) => handleStartResize(e, 'se')} onDoubleClick={(e) => e.stopPropagation()} />
                    <div className="resize-handle handle-s" onMouseDown={(e) => handleStartResize(e, 's')} onDoubleClick={(e) => e.stopPropagation()} />
                    <div className="resize-handle handle-sw" onMouseDown={(e) => handleStartResize(e, 'sw')} onDoubleClick={(e) => e.stopPropagation()} />
                    <div className="resize-handle handle-w" onMouseDown={(e) => handleStartResize(e, 'w')} onDoubleClick={(e) => e.stopPropagation()} />
                  </div>
                )}

                {/* Alignment Guides for Live Snapping */}
                {snapGuides.x !== undefined && (
                  <div
                    className="alignment-guide-line guide-x"
                    style={{ left: `${snapGuides.x * zoom}px` }}
                  />
                )}
                {snapGuides.y !== undefined && (
                  <div
                    className="alignment-guide-line guide-y"
                    style={{ top: `${snapGuides.y * zoom}px` }}
                  />
                )}
              </div>
            </div>
          ) : (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <h3 style={{ marginBottom: 8 }}>No Document Open</h3>
              <p style={{ marginBottom: 14 }}>
                Open a PDF file, create a blank PDF, or launch the 3-page Enterprise MSA Showcase.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                <button className="tool-btn primary" onClick={handleOpenSampleDoc}>
                  <Sparkles size={14} /> Open Showcase PDF
                </button>
                <button className="tool-btn" onClick={handleNativeOrBrowserOpen}>
                  <FolderOpen size={14} /> Open PDF File...
                </button>
              </div>
            </div>
          )}

          {/* Floating Context Menu for Manipulable Objects */}
          {contextMenuPos && selectedObj && (
            <div
              className="object-context-menu"
              style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
              onClick={(e) => e.stopPropagation()}
            >
              {selectedObj.objectType === 'textbox' && (
                <button
                  type="button"
                  onClick={() => {
                    handleStartEditText(selectedObj.data);
                    setContextMenuPos(null);
                  }}
                >
                  <span>Edit Text</span>
                  <span className="kbd">Double-Click</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setClipboardObj({ ...selectedObj });
                  commitObjectTransform(selectedObj, selectedObj.currentBbox, 'delete');
                  setContextMenuPos(null);
                  notify(`Cut ${selectedObj.objectType} to clipboard.`);
                }}
              >
                <span>Cut</span>
                <span className="kbd">Ctrl+X</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setClipboardObj({ ...selectedObj });
                  setContextMenuPos(null);
                  notify(`Copied ${selectedObj.objectType} to clipboard.`);
                }}
              >
                <span>Copy</span>
                <span className="kbd">Ctrl+C</span>
              </button>
              {clipboardObj && (
                <button
                  type="button"
                  onClick={() => {
                    commitObjectTransform(clipboardObj, clipboardObj.currentBbox, 'duplicate');
                    setContextMenuPos(null);
                  }}
                >
                  <span>Paste</span>
                  <span className="kbd">Ctrl+V</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  commitObjectTransform(selectedObj, selectedObj.currentBbox, 'duplicate');
                  setContextMenuPos(null);
                }}
              >
                <span>Duplicate</span>
                <span className="kbd">Ctrl+D</span>
              </button>
              <div className="menu-divider" />
              <button
                type="button"
                onClick={() => {
                  commitObjectTransform(selectedObj, selectedObj.currentBbox, 'delete');
                  setContextMenuPos(null);
                }}
              >
                <span>Delete</span>
                <span className="kbd">Del</span>
              </button>
              <div className="menu-divider" />
              <button
                type="button"
                onClick={() => {
                  setRightOpen(true);
                  setContextMenuPos(null);
                }}
              >
                <span>Properties...</span>
              </button>
            </div>
          )}
        </main>

        {/* 5. RIGHT CONTEXT-SENSITIVE PROPERTIES INSPECTOR */}
        {rightOpen && (
          <aside className="right-inspector">
            <div className="panel-header">
              <span>Properties & Inspector</span>
              <span className="badge pass">{mode.toUpperCase()}</span>
            </div>

            <div className="panel-scroll">
              {/* NEW INLINE TEXT BOX INSPECTOR */}
              {draftTextBox && (
                <div className="inspector-section">
                  <h4>
                    <Type size={14} /> New Text Box Properties
                  </h4>
                  <div style={{ marginBottom: 8, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    Adjust text, styling, and dimensions before inserting into the PDF stream.
                  </div>
                  <div className="form-group">
                    <label>Text Content (Multiline)</label>
                    <textarea
                      rows={4}
                      value={draftTextBox.text}
                      onChange={(e) =>
                        setDraftTextBox((prev) => (prev ? { ...prev, text: e.target.value } : null))
                      }
                      placeholder="Type text directly on page or here..."
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Font Family</label>
                      <select
                        value={draftTextBox.font}
                        onChange={(e) =>
                          setDraftTextBox((prev) => (prev ? { ...prev, font: e.target.value } : null))
                        }
                      >
                        <option value="helv">Helvetica (Sans)</option>
                        <option value="tiro">Times Roman (Serif)</option>
                        <option value="cour">Courier (Mono)</option>
                        <option value="dejavu">DejaVu Sans (Unicode)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Size (pt)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="6"
                        max="144"
                        value={draftTextBox.size}
                        onChange={(e) =>
                          setDraftTextBox((prev) => (prev ? { ...prev, size: Number(e.target.value) } : null))
                        }
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Color</label>
                      <input
                        type="color"
                        value={draftTextBox.color}
                        onChange={(e) =>
                          setDraftTextBox((prev) => (prev ? { ...prev, color: e.target.value } : null))
                        }
                        style={{ height: 30, width: '100%' }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Alignment</label>
                      <select
                        value={draftTextBox.align}
                        onChange={(e) =>
                          setDraftTextBox((prev) => (prev ? { ...prev, align: e.target.value as any } : null))
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                        <option value="justify">Justify</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={draftTextBox.bold}
                        onChange={(e) =>
                          setDraftTextBox((prev) => (prev ? { ...prev, bold: e.target.checked } : null))
                        }
                      />
                      Bold
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={draftTextBox.italic}
                        onChange={(e) =>
                          setDraftTextBox((prev) => (prev ? { ...prev, italic: e.target.checked } : null))
                        }
                      />
                      Italic
                    </label>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>X0 (pt)</label>
                      <input
                        type="number"
                        value={Math.round(draftTextBox.bbox[0])}
                        onChange={(e) => {
                          const nx = Number(e.target.value);
                          const w = draftTextBox.bbox[2] - draftTextBox.bbox[0];
                          setDraftTextBox((prev) =>
                            prev ? { ...prev, bbox: [nx, prev.bbox[1], +(nx + w).toFixed(1), prev.bbox[3]] } : null
                          );
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Y0 (pt)</label>
                      <input
                        type="number"
                        value={Math.round(draftTextBox.bbox[1])}
                        onChange={(e) => {
                          const ny = Number(e.target.value);
                          const h = draftTextBox.bbox[3] - draftTextBox.bbox[1];
                          setDraftTextBox((prev) =>
                            prev ? { ...prev, bbox: [prev.bbox[0], ny, prev.bbox[2], +(ny + h).toFixed(1)] } : null
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Width (pt)</label>
                      <input
                        type="number"
                        min="20"
                        value={Math.round(draftTextBox.bbox[2] - draftTextBox.bbox[0])}
                        onChange={(e) => {
                          const nw = Math.max(20, Number(e.target.value));
                          setDraftTextBox((prev) =>
                            prev ? { ...prev, bbox: [prev.bbox[0], prev.bbox[1], +(prev.bbox[0] + nw).toFixed(1), prev.bbox[3]] } : null
                          );
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Height (pt)</label>
                      <input
                        type="number"
                        min="16"
                        value={Math.round(draftTextBox.bbox[3] - draftTextBox.bbox[1])}
                        onChange={(e) => {
                          const nh = Math.max(16, Number(e.target.value));
                          setDraftTextBox((prev) =>
                            prev ? { ...prev, bbox: [prev.bbox[0], prev.bbox[1], prev.bbox[2], +(prev.bbox[1] + nh).toFixed(1)] } : null
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Background</label>
                      <select
                        value={draftTextBox.bg_hex || 'transparent'}
                        onChange={(e) =>
                          setDraftTextBox((prev) => (prev ? { ...prev, bg_hex: e.target.value } : null))
                        }
                      >
                        <option value="transparent">Transparent (None)</option>
                        <option value="#ffffff">White (#FFFFFF)</option>
                        <option value="#fef9c3">Soft Yellow (#FEF9C3)</option>
                        <option value="#f1f5f9">Light Slate (#F1F5F9)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Border</label>
                      <select
                        value={draftTextBox.border_hex || 'transparent'}
                        onChange={(e) =>
                          setDraftTextBox((prev) => (prev ? { ...prev, border_hex: e.target.value } : null))
                        }
                      >
                        <option value="transparent">No Border</option>
                        <option value="#000000">Black (#000000)</option>
                        <option value="#475569">Slate (#475569)</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      className="tool-btn"
                      style={{ flex: 1, fontSize: 11 }}
                      onClick={() =>
                        saveTextBoxDefaults({
                          color: draftTextBox.color,
                          font: draftTextBox.font,
                          size: draftTextBox.size,
                          align: draftTextBox.align,
                          bg_hex: draftTextBox.bg_hex || 'transparent',
                          border_hex: draftTextBox.border_hex || 'transparent',
                        })
                      }
                      title="Save current styling as persistent default for new text boxes"
                    >
                      Save as Default
                    </button>
                    <button
                      type="button"
                      className="tool-btn"
                      style={{ fontSize: 11 }}
                      onClick={() => {
                        resetTextBoxDefaults();
                        setDraftTextBox((prev) =>
                          prev
                            ? {
                                ...prev,
                                color: FACTORY_TEXTBOX_DEFAULTS.color,
                                font: FACTORY_TEXTBOX_DEFAULTS.font,
                                size: FACTORY_TEXTBOX_DEFAULTS.size,
                                align: FACTORY_TEXTBOX_DEFAULTS.align,
                                bg_hex: FACTORY_TEXTBOX_DEFAULTS.bg_hex,
                                border_hex: FACTORY_TEXTBOX_DEFAULTS.border_hex,
                              }
                            : null
                        );
                      }}
                      title="Reset to #000000, Helvetica 11pt, Left, Transparent"
                    >
                      Reset Defaults
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button
                      className="tool-btn primary"
                      style={{ flex: 1 }}
                      onClick={handleCommitDraftTextBox}
                    >
                      <Check size={14} /> Insert into PDF
                    </button>
                    <button
                      className="tool-btn"
                      onClick={handleCancelDraftTextBox}
                      title="Cancel and discard text box"
                    >
                      <X size={14} /> Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* ACROBAT-STYLE PARAGRAPH EDITOR INSPECTOR */}
              {draftParagraph && (() => {
                const fallbackRun: TextRun = {
                  text: '',
                  font: draftParagraph.font,
                  size: draftParagraph.size,
                  color: draftParagraph.color,
                  bold: draftParagraph.bold,
                  italic: draftParagraph.italic,
                };
                const selStyle = getSelectionStyle(
                  draftParagraph.runs,
                  draftParagraph.selectionRange.start,
                  draftParagraph.selectionRange.end,
                  fallbackRun
                );
                const hasSelection =
                  draftParagraph.selectionRange.end > draftParagraph.selectionRange.start;
                return (
                <div className="inspector-section">
                  <h4>
                    <FileText size={14} /> Paragraph Editor & Reflow
                  </h4>
                  <p className="hint-text">
                    Original font: <strong>{draftParagraph.originalFont}</strong>
                    {draftParagraph.hasSubsetFont ? ' (subset)' : ''}
                    {draftParagraph.runs.length > 1 || draftParagraph.isMixedStyle ? ' · mixed inline styles' : ''}
                  </p>
                  {hasSelection && (
                    <p className="hint-text" style={{ color: 'var(--accent, #2563eb)', fontWeight: 500 }}>
                      Selection ({draftParagraph.selectionRange.end - draftParagraph.selectionRange.start} chars) — styling applies only to selection
                    </p>
                  )}
                  <div className="form-group">
                    <label>Paragraph Text (Reflows inside width)</label>
                    <textarea
                      rows={5}
                      value={draftParagraph.text}
                      onChange={(e) => handleParagraphInspectorTextChange(e.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Font Family</label>
                      <select
                        value={selStyle.font}
                        onChange={(e) => applyParagraphStylePatch({ font: e.target.value })}
                      >
                        <option value={draftParagraph.originalFont}>
                          Original ({draftParagraph.originalFont})
                        </option>
                        <option value="helv">Helvetica (Sans)</option>
                        <option value="tiro">Times Roman (Serif)</option>
                        <option value="cour">Courier (Mono)</option>
                        <option value="dejavu">DejaVu Sans (Unicode)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Size (pt)</label>
                      <input
                        type="number"
                        step="0.5"
                        min="6"
                        max="144"
                        value={selStyle.size}
                        onChange={(e) =>
                          applyParagraphStylePatch({ size: Math.max(6, Number(e.target.value) || 12) })
                        }
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Color</label>
                      <input
                        type="color"
                        value={selStyle.color}
                        onChange={(e) => applyParagraphStylePatch({ color: e.target.value })}
                        style={{ height: 30, width: '100%' }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Alignment</label>
                      <select
                        value={draftParagraph.align}
                        onChange={(e) =>
                          setDraftParagraph((prev) =>
                            prev ? { ...prev, align: e.target.value as any } : null
                          )
                        }
                      >
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Line Spacing</label>
                      <input
                        type="number"
                        step="0.05"
                        min="1.0"
                        max="2.2"
                        value={draftParagraph.lineHeight}
                        onChange={(e) =>
                          setDraftParagraph((prev) =>
                            prev ? { ...prev, lineHeight: Number(e.target.value), overflowInfo: null } : null
                          )
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label>Width (pt)</label>
                      <input
                        type="number"
                        min="40"
                        value={Math.round(draftParagraph.targetBbox[2] - draftParagraph.targetBbox[0])}
                        onChange={(e) => {
                          const nw = Math.max(40, Number(e.target.value));
                          setDraftParagraph((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  targetBbox: [
                                    prev.targetBbox[0],
                                    prev.targetBbox[1],
                                    +(prev.targetBbox[0] + nw).toFixed(1),
                                    prev.targetBbox[3],
                                  ],
                                  overflowInfo: null,
                                }
                              : null
                          );
                        }}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={selStyle.bold}
                        onChange={(e) => applyParagraphStylePatch({ bold: e.target.checked })}
                      />
                      Bold
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={selStyle.italic}
                        onChange={(e) => applyParagraphStylePatch({ italic: e.target.checked })}
                      />
                      Italic
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button
                      className="tool-btn primary"
                      style={{ flex: 1 }}
                      onClick={() => handleCommitDraftParagraph('check')}
                    >
                      <Check size={14} /> Apply Reflow
                    </button>
                    <button className="tool-btn" onClick={handleCancelDraftParagraph}>
                      <X size={14} /> Cancel
                    </button>
                  </div>
                </div>
                );
              })()}

              {/* UNIFIED OBJECT SELECTION & TRANSFORM INSPECTOR */}
              {selectedObj && !draftTextBox && !draftParagraph && (
                <div className="inspector-section">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <h4 style={{ margin: 0 }}>
                      <Move size={14} />{' '}
                      {selectedObj.objectType === 'textbox'
                        ? 'Selected Text Box'
                        : selectedObj.objectType === 'shape'
                        ? `Vector Shape (${selectedObj.data?.shape_type || 'shape'})`
                        : selectedObj.objectType === 'image'
                        ? 'Embedded Image'
                        : 'Text Span'}
                    </h4>
                    <span className="badge pass">{selectedObj.objectType.toUpperCase()}</span>
                  </div>

                  <div style={{ marginBottom: 10, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                    Coordinates in PostScript points. Drag on canvas or edit fields below.
                  </div>

                  {/* Geometry Inputs (X, Y, Width, Height) */}
                  <div className="form-row">
                    <div className="form-group">
                      <label>X0 (pt)</label>
                      <input
                        type="number"
                        value={Math.round(selectedObj.currentBbox[0])}
                        onChange={(e) => {
                          const nx = Number(e.target.value);
                          const w = selectedObj.currentBbox[2] - selectedObj.currentBbox[0];
                          const nb: [number, number, number, number] = [
                            nx,
                            selectedObj.currentBbox[1],
                            +(nx + w).toFixed(1),
                            selectedObj.currentBbox[3],
                          ];
                          setSelectedObj({ ...selectedObj, currentBbox: nb });
                        }}
                        onBlur={() => commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move');
                          }
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Y0 (pt)</label>
                      <input
                        type="number"
                        value={Math.round(selectedObj.currentBbox[1])}
                        onChange={(e) => {
                          const ny = Number(e.target.value);
                          const h = selectedObj.currentBbox[3] - selectedObj.currentBbox[1];
                          const nb: [number, number, number, number] = [
                            selectedObj.currentBbox[0],
                            ny,
                            selectedObj.currentBbox[2],
                            +(ny + h).toFixed(1),
                          ];
                          setSelectedObj({ ...selectedObj, currentBbox: nb });
                        }}
                        onBlur={() => commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move');
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label>Width (pt)</label>
                      <input
                        type="number"
                        min="15"
                        value={Math.round(selectedObj.currentBbox[2] - selectedObj.currentBbox[0])}
                        onChange={(e) => {
                          const nw = Math.max(15, Number(e.target.value));
                          const nb: [number, number, number, number] = [
                            selectedObj.currentBbox[0],
                            selectedObj.currentBbox[1],
                            +(selectedObj.currentBbox[0] + nw).toFixed(1),
                            selectedObj.currentBbox[3],
                          ];
                          setSelectedObj({ ...selectedObj, currentBbox: nb });
                        }}
                        onBlur={() => commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move');
                          }
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Height (pt)</label>
                      <input
                        type="number"
                        min="10"
                        value={Math.round(selectedObj.currentBbox[3] - selectedObj.currentBbox[1])}
                        onChange={(e) => {
                          const nh = Math.max(10, Number(e.target.value));
                          const nb: [number, number, number, number] = [
                            selectedObj.currentBbox[0],
                            selectedObj.currentBbox[1],
                            selectedObj.currentBbox[2],
                            +(selectedObj.currentBbox[1] + nh).toFixed(1),
                          ];
                          setSelectedObj({ ...selectedObj, currentBbox: nb });
                        }}
                        onBlur={() => commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move');
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Object Type Specific Controls */}
                  {selectedObj.objectType === 'textbox' && (
                    <>
                      <div style={{ marginTop: 8, marginBottom: 8 }}>
                        <button
                          type="button"
                          className="tool-btn primary"
                          style={{ width: '100%' }}
                          onClick={() => handleStartEditText(selectedObj.data)}
                        >
                          <Type size={13} /> Edit Text Directly On Page (Double-Click)
                        </button>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Font</label>
                          <select
                            value={selectedObj.data?.font || 'helv'}
                            onChange={(e) => {
                              const f = e.target.value;
                              commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move', { font_name: f });
                            }}
                          >
                            <option value="helv">Helvetica</option>
                            <option value="tiro">Times Roman</option>
                            <option value="cour">Courier</option>
                            <option value="dejavu">DejaVu Sans</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Font Size</label>
                          <input
                            type="number"
                            step="0.5"
                            value={selectedObj.data?.size || 12}
                            onChange={(e) => {
                              const s = Number(e.target.value);
                              commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move', { font_size: s });
                            }}
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Color</label>
                          <input
                            type="color"
                            value={selectedObj.data?.color || '#000000'}
                            onChange={(e) => {
                              const c = e.target.value;
                              commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move', { color_hex: c });
                            }}
                            style={{ height: 30, width: '100%' }}
                          />
                        </div>
                        <div className="form-group">
                          <label>Alignment</label>
                          <select
                            value={selectedObj.data?.align || 'left'}
                            onChange={(e) => {
                              const a = e.target.value;
                              commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move', { align: a });
                            }}
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                            <option value="justify">Justify</option>
                          </select>
                        </div>
                      </div>
                    </>
                  )}

                  {selectedObj.objectType === 'shape' && (
                    <>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Stroke Color</label>
                          <input
                            type="color"
                            value={selectedObj.data?.stroke_hex || '#1d4ed8'}
                            onChange={(e) => {
                              const sc = e.target.value;
                              commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move', { stroke_hex: sc });
                            }}
                            style={{ height: 30, width: '100%' }}
                          />
                        </div>
                        <div className="form-group">
                          <label>Fill Color</label>
                          <input
                            type="color"
                            value={selectedObj.data?.fill_hex || '#ffffff'}
                            onChange={(e) => {
                              const fc = e.target.value;
                              commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move', { fill_hex: fc });
                            }}
                            style={{ height: 30, width: '100%' }}
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Stroke Width (pt)</label>
                          <input
                            type="number"
                            step="0.5"
                            min="0.5"
                            max="36"
                            value={editShapeStrokeWidth}
                            onChange={(e) => {
                              const sw = Number(e.target.value);
                              setEditShapeStrokeWidth(sw);
                              commitObjectTransform(selectedObj, selectedObj.currentBbox, 'move', { stroke_width: sw });
                            }}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {/* Actions Row */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    <button
                      type="button"
                      className="tool-btn"
                      style={{ flex: 1 }}
                      onClick={() => commitObjectTransform(selectedObj, selectedObj.currentBbox, 'duplicate')}
                      title="Duplicate Object (Ctrl+D)"
                    >
                      <Copy size={13} /> Duplicate
                    </button>
                    <button
                      type="button"
                      className="tool-btn danger"
                      onClick={() => commitObjectTransform(selectedObj, selectedObj.currentBbox, 'delete')}
                      title="Delete Object (Del)"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                    <button
                      type="button"
                      className="tool-btn"
                      onClick={() => setSelectedObj(null)}
                      title="Deselect (Esc)"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              )}

              {/* DIRECT TEXT SPAN INSPECTOR */}
              {selectedSpan && (
                <div className="inspector-section">
                  <h4>
                    <Type size={14} /> Direct PDF Text Stream Editor
                  </h4>
                  <div style={{ marginBottom: 8 }}>
                    <span className={`badge ${selectedSpan.is_subset_font ? 'warn' : 'pass'}`}>
                      Orig Font: {selectedSpan.font} {selectedSpan.is_subset_font ? '(Subset)' : ''}
                    </span>
                  </div>
                  <div className="form-group">
                    <label>Text Content (Direct Content Stream)</label>
                    <textarea
                      rows={3}
                      value={editSpanText}
                      onChange={(e) => setEditSpanText(e.target.value)}
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Font Family</label>
                      <select value={editSpanFont} onChange={(e) => setEditSpanFont(e.target.value)}>
                        <option value={selectedSpan.font}>Keep Original ({selectedSpan.font})</option>
                        <option value="helv">Helvetica (Sans)</option>
                        <option value="tiro">Times Roman (Serif)</option>
                        <option value="cour">Courier (Mono)</option>
                        <option value="dejavu">DejaVu Sans (Unicode)</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Size (pt)</label>
                      <input
                        type="number"
                        step="0.5"
                        value={editSpanSize}
                        onChange={(e) => setEditSpanSize(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Color</label>
                      <input
                        type="color"
                        value={editSpanColor}
                        onChange={(e) => setEditSpanColor(e.target.value)}
                        style={{ height: 30, width: '100%' }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Alignment</label>
                      <select value={editSpanAlign} onChange={(e) => setEditSpanAlign(e.target.value)}>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                        <option value="justify">Justify</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-row">
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={editSpanBold}
                        onChange={(e) => setEditSpanBold(e.target.checked)}
                      />
                      Bold
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={editSpanItalic}
                        onChange={(e) => setEditSpanItalic(e.target.checked)}
                      />
                      Italic
                    </label>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>X (pt)</label>
                      <input
                        type="number"
                        value={editSpanBbox[0]}
                        onChange={(e) => {
                          const nx = Number(e.target.value);
                          const w = editSpanBbox[2] - editSpanBbox[0];
                          setEditSpanBbox([nx, editSpanBbox[1], +(nx + w).toFixed(1), editSpanBbox[3]]);
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label>Y (pt)</label>
                      <input
                        type="number"
                        value={editSpanBbox[1]}
                        onChange={(e) => {
                          const ny = Number(e.target.value);
                          const h = editSpanBbox[3] - editSpanBbox[1];
                          setEditSpanBbox([editSpanBbox[0], ny, editSpanBbox[2], +(ny + h).toFixed(1)]);
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <button className="tool-btn primary" style={{ flex: 1 }} onClick={() => handleCommitTextSpanEdit(false)}>
                      Apply Stream Edit
                    </button>
                    <button className="tool-btn danger" onClick={() => handleCommitTextSpanEdit(true)} title="Delete text span from stream">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}

              {/* DIRECT IMAGE OBJECT INSPECTOR */}
              {selectedImage && (
                <div className="inspector-section">
                  <h4>
                    <ImageIcon size={14} /> Embedded Image Object (xref #{selectedImage.xref})
                  </h4>
                  {selectedImage.thumbnail_base64 && (
                    <img
                      src={`data:image/png;base64,${selectedImage.thumbnail_base64}`}
                      alt="Selected PDF Image"
                      style={{ maxWidth: '100%', maxHeight: 110, borderRadius: 4, marginBottom: 8 }}
                    />
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
                    Raster: {selectedImage.width}×{selectedImage.height}px ({selectedImage.colorspace})
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>X0 (pt)</label>
                      <input
                        type="number"
                        value={editImgBbox[0]}
                        onChange={(e) =>
                          setEditImgBbox([Number(e.target.value), editImgBbox[1], editImgBbox[2], editImgBbox[3]])
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label>Y0 (pt)</label>
                      <input
                        type="number"
                        value={editImgBbox[1]}
                        onChange={(e) =>
                          setEditImgBbox([editImgBbox[0], Number(e.target.value), editImgBbox[2], editImgBbox[3]])
                        }
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>X1 (pt)</label>
                      <input
                        type="number"
                        value={editImgBbox[2]}
                        onChange={(e) =>
                          setEditImgBbox([editImgBbox[0], editImgBbox[1], Number(e.target.value), editImgBbox[3]])
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label>Y1 (pt)</label>
                      <input
                        type="number"
                        value={editImgBbox[3]}
                        onChange={(e) =>
                          setEditImgBbox([editImgBbox[0], editImgBbox[1], editImgBbox[2], Number(e.target.value)])
                        }
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Rotate</label>
                      <select
                        value={editImgRotation}
                        onChange={(e) => setEditImgRotation(Number(e.target.value))}
                      >
                        <option value={0}>0°</option>
                        <option value={90}>90° CW</option>
                        <option value={180}>180°</option>
                        <option value={270}>270° CW</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Crop Inset (0..0.4)</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="0.4"
                        value={editImgCrop[0]}
                        onChange={(e) => {
                          const c = Math.max(0, Math.min(0.4, Number(e.target.value)));
                          setEditImgCrop([c, c, +(1 - c).toFixed(2), +(1 - c).toFixed(2)]);
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    <button className="tool-btn primary" onClick={() => handleCommitImageEdit('transform')}>
                      Apply Transform/Crop
                    </button>
                    <button className="tool-btn" onClick={() => imageReplaceInputRef.current?.click()}>
                      Replace Image...
                    </button>
                    <button className="tool-btn danger" onClick={() => handleCommitImageEdit('delete')}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              )}

              {/* PAGE ORGANIZATION INSPECTOR */}
              {mode === 'pages' && activeDoc && (
                <>
                  <div className="inspector-section">
                    <h4>
                      <Crop size={14} /> Crop Page Margins (pt)
                    </h4>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Top</label>
                        <input
                          type="number"
                          value={cropMarginTop}
                          onChange={(e) => setCropMarginTop(Number(e.target.value))}
                        />
                      </div>
                      <div className="form-group">
                        <label>Bottom</label>
                        <input
                          type="number"
                          value={cropMarginBottom}
                          onChange={(e) => setCropMarginBottom(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Left</label>
                        <input
                          type="number"
                          value={cropMarginLeft}
                          onChange={(e) => setCropMarginLeft(Number(e.target.value))}
                        />
                      </div>
                      <div className="form-group">
                        <label>Right</label>
                        <input
                          type="number"
                          value={cropMarginRight}
                          onChange={(e) => setCropMarginRight(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <button
                      className="tool-btn primary"
                      style={{ width: '100%' }}
                      onClick={async () => {
                        const s = await pdfApi.cropPage(activeDoc.doc_id, {
                          page_index: currentPage,
                          margins: {
                            top: cropMarginTop,
                            bottom: cropMarginBottom,
                            left: cropMarginLeft,
                            right: cropMarginRight,
                          },
                          apply_to_all: false,
                        });
                        await refreshDocState(activeDoc.doc_id, currentPage, s);
                        notify(`Cropped Page ${currentPage + 1}.`);
                      }}
                    >
                      Apply CropBox to Current Page
                    </button>
                  </div>

                  <div className="inspector-section">
                    <h4>
                      <Maximize2 size={14} /> Resize Page Dimensions
                    </h4>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="tool-btn"
                        style={{ flex: 1 }}
                        onClick={async () => {
                          const s = await pdfApi.resizePages(activeDoc.doc_id, {
                            new_width: 595,
                            new_height: 842,
                            page_indices: [currentPage],
                            scale_content: true,
                          });
                          await refreshDocState(activeDoc.doc_id, currentPage, s);
                          notify('Resized page to ISO A4 (595×842pt).');
                        }}
                      >
                        A4 (595×842)
                      </button>
                      <button
                        className="tool-btn"
                        style={{ flex: 1 }}
                        onClick={async () => {
                          const s = await pdfApi.resizePages(activeDoc.doc_id, {
                            new_width: 612,
                            new_height: 792,
                            page_indices: [currentPage],
                            scale_content: true,
                          });
                          await refreshDocState(activeDoc.doc_id, currentPage, s);
                          notify('Resized page to US Letter (612×792pt).');
                        }}
                      >
                        Letter (612×792)
                      </button>
                    </div>
                  </div>

                  <div className="inspector-section">
                    <h4>
                      <Split size={14} /> Split PDF by Page Ranges
                    </h4>
                    <div className="form-group">
                      <label>Ranges (semicolon-separated, e.g. 1; 2-3)</label>
                      <input
                        type="text"
                        value={splitRangeSpec}
                        onChange={(e) => setSplitRangeSpec(e.target.value)}
                      />
                    </div>
                    <button
                      className="tool-btn primary"
                      style={{ width: '100%' }}
                      onClick={async () => {
                        const res = await pdfApi.splitPdf(activeDoc.doc_id, 'ranges', splitRangeSpec, 1);
                        setOpenDocs((prev) => [...prev, ...res.created_tabs]);
                        notify(`Split PDF into ${res.split_count} new document tabs.`);
                      }}
                    >
                      Split Into Document Tabs
                    </button>
                  </div>
                </>
              )}

              {/* INTERACTIVE FORMS & PREPARE FORM INSPECTOR */}
              {mode === 'forms' && activeDoc && (
                <>
                  {formInspection?.is_xfa && (
                    <div className="inspector-section" style={{ borderLeft: '3px solid #f59e0b', paddingLeft: 8 }}>
                      <h4 style={{ color: '#f59e0b' }}>
                        <AlertTriangle size={14} /> XFA Form Detected
                      </h4>
                      <p className="hint-text">{formInspection.xfa_notice}</p>
                    </div>
                  )}

                  {formFillWarnings.length > 0 && (
                    <div className="inspector-section" style={{ borderLeft: '3px solid #f59e0b', paddingLeft: 8 }}>
                      <h4>
                        <AlertTriangle size={14} /> Text Fitting Warnings ({formFillWarnings.length})
                      </h4>
                      {formFillWarnings.map((w, i) => (
                        <p key={`${w.xref}_${i}`} className="hint-text" style={{ marginBottom: 4 }}>
                          <strong>{w.field_name}:</strong> {w.message}
                        </p>
                      ))}
                    </div>
                  )}

                  {selectedField ? (
                    <div className="inspector-section">
                      <h4>
                        <Edit3 size={14} /> Field Properties ({selectedField.field_type})
                      </h4>
                      <div className="form-group">
                        <label>Field Name</label>
                        <input
                          type="text"
                          value={selectedField.field_name}
                          onChange={(e) =>
                            setSelectedField((prev) => (prev ? { ...prev, field_name: e.target.value } : null))
                          }
                        />
                      </div>
                      <div className="form-group">
                        <label>Tooltip / Label</label>
                        <input
                          type="text"
                          value={selectedField.field_label}
                          onChange={(e) =>
                            setSelectedField((prev) => (prev ? { ...prev, field_label: e.target.value } : null))
                          }
                        />
                      </div>
                      {(selectedField.field_type === 'dropdown' || selectedField.field_type === 'listbox') && (
                        <div className="form-group">
                          <label>Options (comma-separated)</label>
                          <input
                            type="text"
                            value={selectedField.choices.join(', ')}
                            onChange={(e) =>
                              setSelectedField((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      choices: e.target.value
                                        .split(',')
                                        .map((s) => s.trim())
                                        .filter(Boolean),
                                    }
                                  : null
                              )
                            }
                          />
                        </div>
                      )}
                      <div className="form-row">
                        <div className="form-group">
                          <label>Font Size (0=Auto)</label>
                          <input
                            type="number"
                            min="0"
                            max="72"
                            step="0.5"
                            value={selectedField.text_fontsize}
                            onChange={(e) =>
                              setSelectedField((prev) =>
                                prev ? { ...prev, text_fontsize: Number(e.target.value) } : null
                              )
                            }
                          />
                        </div>
                        <div className="form-group">
                          <label>Alignment</label>
                          <select
                            value={selectedField.align || 'left'}
                            onChange={(e) =>
                              setSelectedField((prev) => (prev ? { ...prev, align: e.target.value } : null))
                            }
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </div>
                      </div>
                      <div className="form-row">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedField.required)}
                            onChange={(e) =>
                              setSelectedField((prev) => (prev ? { ...prev, required: e.target.checked } : null))
                            }
                          />
                          Required
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedField.read_only)}
                            onChange={(e) =>
                              setSelectedField((prev) => (prev ? { ...prev, read_only: e.target.checked } : null))
                            }
                          />
                          Read-Only
                        </label>
                        {selectedField.field_type === 'text' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedField.multiline)}
                              onChange={(e) =>
                                setSelectedField((prev) => (prev ? { ...prev, multiline: e.target.checked } : null))
                              }
                            />
                            Multiline
                          </label>
                        )}
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>X (pt)</label>
                          <input
                            type="number"
                            value={Math.round(selectedField.bbox[0])}
                            onChange={(e) => {
                              const nx = Number(e.target.value);
                              const w = selectedField.bbox[2] - selectedField.bbox[0];
                              setSelectedField((prev) =>
                                prev ? { ...prev, bbox: [nx, prev.bbox[1], +(nx + w).toFixed(1), prev.bbox[3]] } : null
                              );
                            }}
                          />
                        </div>
                        <div className="form-group">
                          <label>Y (pt)</label>
                          <input
                            type="number"
                            value={Math.round(selectedField.bbox[1])}
                            onChange={(e) => {
                              const ny = Number(e.target.value);
                              const h = selectedField.bbox[3] - selectedField.bbox[1];
                              setSelectedField((prev) =>
                                prev ? { ...prev, bbox: [prev.bbox[0], ny, prev.bbox[2], +(ny + h).toFixed(1)] } : null
                              );
                            }}
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Width (pt)</label>
                          <input
                            type="number"
                            min="12"
                            value={Math.round(selectedField.bbox[2] - selectedField.bbox[0])}
                            onChange={(e) => {
                              const nw = Math.max(12, Number(e.target.value));
                              setSelectedField((prev) =>
                                prev ? { ...prev, bbox: [prev.bbox[0], prev.bbox[1], +(prev.bbox[0] + nw).toFixed(1), prev.bbox[3]] } : null
                              );
                            }}
                          />
                        </div>
                        <div className="form-group">
                          <label>Height (pt)</label>
                          <input
                            type="number"
                            min="12"
                            value={Math.round(selectedField.bbox[3] - selectedField.bbox[1])}
                            onChange={(e) => {
                              const nh = Math.max(12, Number(e.target.value));
                              setSelectedField((prev) =>
                                prev ? { ...prev, bbox: [prev.bbox[0], prev.bbox[1], prev.bbox[2], +(prev.bbox[1] + nh).toFixed(1)] } : null
                              );
                            }}
                          />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button
                          className="tool-btn primary"
                          style={{ flex: 1 }}
                          onClick={async () => {
                            const res = await pdfApi.updateFormField(activeDoc.doc_id, selectedField.xref, {
                              page_index: selectedField.page_index,
                              field_name: selectedField.field_name,
                              tooltip: selectedField.field_label,
                              bbox: selectedField.bbox,
                              choices: selectedField.choices,
                              font_size: selectedField.text_fontsize,
                              align: selectedField.align,
                              required: selectedField.required,
                              read_only: selectedField.read_only,
                              multiline: selectedField.multiline,
                            });
                            await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                            notify(`Updated form field '${selectedField.field_name}'.`);
                          }}
                        >
                          Apply Field Changes
                        </button>
                        <button
                          className="tool-btn"
                          title="Duplicate field"
                          onClick={async () => {
                            const res = await pdfApi.duplicateFormField(
                              activeDoc.doc_id,
                              selectedField.xref,
                              selectedField.page_index
                            );
                            await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                            notify(`Duplicated '${selectedField.field_name}'.`);
                          }}
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          className="tool-btn danger"
                          title="Delete field"
                          onClick={async () => {
                            const res = await pdfApi.deleteFormField(
                              activeDoc.doc_id,
                              selectedField.xref,
                              selectedField.page_index
                            );
                            setSelectedField(null);
                            await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                            notify(`Deleted form field '${selectedField.field_name}'.`);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="inspector-section">
                      <h4>
                        <FileText size={14} /> Prepare Form & Creation Defaults
                      </h4>
                      <p className="hint-text">
                        Click a field on the page to fill or edit it, or choose a tool above and drag to add a new AcroForm widget.
                      </p>
                      <div className="form-group">
                        <label>New Field Name</label>
                        <input
                          type="text"
                          value={newFieldName}
                          onChange={(e) => setNewFieldName(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label>Choices (Dropdown / ListBox)</label>
                        <input
                          type="text"
                          value={newFieldChoices}
                          onChange={(e) => setNewFieldChoices(e.target.value)}
                        />
                      </div>
                      <div className="form-row">
                        <div className="form-group">
                          <label>Alignment</label>
                          <select
                            value={newFieldAlign}
                            onChange={(e) => setNewFieldAlign(e.target.value as any)}
                          >
                            <option value="left">Left</option>
                            <option value="center">Center</option>
                            <option value="right">Right</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Max Length (0=None)</label>
                          <input
                            type="number"
                            min="0"
                            value={newFieldMaxLen}
                            onChange={(e) => setNewFieldMaxLen(Math.max(0, Number(e.target.value)))}
                          />
                        </div>
                      </div>
                      <div className="form-row">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={newFieldRequired}
                            onChange={(e) => setNewFieldRequired(e.target.checked)}
                          />
                          Required
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={newFieldReadOnly}
                            onChange={(e) => setNewFieldReadOnly(e.target.checked)}
                          />
                          Read-Only
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <input
                            type="checkbox"
                            checked={newFieldMultiline}
                            onChange={(e) => setNewFieldMultiline(e.target.checked)}
                          />
                          Multiline
                        </label>
                      </div>
                    </div>
                  )}

                  {pageFormFields.length > 0 && (
                    <div className="inspector-section">
                      <h4>Tab Order (Page {currentPage + 1})</h4>
                      {[...pageFormFields]
                        .sort((a, b) => (a.tab_order ?? 0) - (b.tab_order ?? 0))
                        .map((fld, idx, arr) => (
                          <div
                            key={fld.xref}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '3px 4px',
                              fontSize: 11.5,
                              borderBottom: '1px solid var(--border-subtle)',
                            }}
                          >
                            <span
                              style={{ cursor: 'pointer', flex: 1 }}
                              onClick={() => {
                                setSelectedField(fld);
                                formWidgetRefs.current[fld.xref]?.focus();
                              }}
                            >
                              {idx + 1}. {fld.field_name} ({fld.field_type})
                            </span>
                            <div style={{ display: 'flex', gap: 2 }}>
                              <button
                                className="tool-btn"
                                disabled={idx === 0}
                                onClick={async () => {
                                  const order = arr.map((x) => x.xref);
                                  [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
                                  const res = await pdfApi.reorderFormTabOrder(activeDoc.doc_id, currentPage, order);
                                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                                }}
                              >
                                ↑
                              </button>
                              <button
                                className="tool-btn"
                                disabled={idx === arr.length - 1}
                                onClick={async () => {
                                  const order = arr.map((x) => x.xref);
                                  [order[idx], order[idx + 1]] = [order[idx + 1], order[idx]];
                                  const res = await pdfApi.reorderFormTabOrder(activeDoc.doc_id, currentPage, order);
                                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                                }}
                              >
                                ↓
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}

                  {formCandidates.length > 0 && (
                    <div className="inspector-section">
                      <h4>
                        <Sparkles size={14} /> Suggested Fields ({formCandidates.length})
                      </h4>
                      <p className="hint-text">
                        Review and confirm before inserting interactive fields into the PDF.
                      </p>
                      {formCandidates.map((cand) => (
                        <div
                          key={cand.id}
                          style={{
                            padding: '6px 0',
                            borderBottom: '1px solid var(--border-subtle)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                            <input
                              type="checkbox"
                              checked={cand.accepted !== false}
                              onChange={(e) =>
                                setFormCandidates((prev) =>
                                  prev.map((c) => (c.id === cand.id ? { ...c, accepted: e.target.checked } : c))
                                )
                              }
                            />
                            <input
                              type="text"
                              value={cand.field_name}
                              onChange={(e) =>
                                setFormCandidates((prev) =>
                                  prev.map((c) => (c.id === cand.id ? { ...c, field_name: e.target.value } : c))
                                )
                              }
                              style={{ flex: 1, fontSize: 11.5 }}
                            />
                            <select
                              value={cand.field_type}
                              onChange={(e) =>
                                setFormCandidates((prev) =>
                                  prev.map((c) => (c.id === cand.id ? { ...c, field_type: e.target.value } : c))
                                )
                              }
                              style={{ fontSize: 11 }}
                            >
                              <option value="text">text</option>
                              <option value="multiline">multiline</option>
                              <option value="checkbox">checkbox</option>
                            </select>
                          </label>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                        <button
                          className="tool-btn primary"
                          style={{ flex: 1 }}
                          onClick={async () => {
                            const selected = formCandidates.filter((c) => c.accepted !== false);
                            let lastSummary = activeDoc;
                            for (const c of selected) {
                              const res = await pdfApi.createFormField(activeDoc.doc_id, {
                                page_index: c.page_index,
                                field_type: c.field_type,
                                field_name: c.field_name,
                                bbox: c.bbox,
                                multiline: c.field_type === 'multiline',
                                tooltip: c.label,
                                fill_color_hex: 'transparent',
                                border_color_hex: 'transparent',
                              });
                              lastSummary = res.summary;
                            }
                            setFormCandidates([]);
                            await refreshDocState(activeDoc.doc_id, currentPage, lastSummary);
                            notify(`Inserted ${selected.length} confirmed form field(s).`);
                          }}
                        >
                          Confirm Selected ({formCandidates.filter((c) => c.accepted !== false).length})
                        </button>
                        <button
                          className="tool-btn"
                          onClick={async () => {
                            let lastSummary = activeDoc;
                            for (const c of formCandidates) {
                              const res = await pdfApi.createFormField(activeDoc.doc_id, {
                                page_index: c.page_index,
                                field_type: c.field_type,
                                field_name: c.field_name,
                                bbox: c.bbox,
                                multiline: c.field_type === 'multiline',
                                tooltip: c.label,
                                fill_color_hex: 'transparent',
                                border_color_hex: 'transparent',
                              });
                              lastSummary = res.summary;
                            }
                            const count = formCandidates.length;
                            setFormCandidates([]);
                            await refreshDocState(activeDoc.doc_id, currentPage, lastSummary);
                            notify(`Accepted and inserted all ${count} detected form field(s).`);
                          }}
                        >
                          Accept All
                        </button>
                        <button className="tool-btn" onClick={() => setFormCandidates([])}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* SIGNATURES & PKCS#12 CERTIFICATE INSPECTOR */}
              {mode === 'sign' && activeDoc && (
                <div className="inspector-section">
                  <h4>
                    <KeyRound size={14} /> X.509 PKCS#12 Certificate & Signer
                  </h4>
                  <div className="form-group">
                    <label>Signer Common Name (CN)</label>
                    <input type="text" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Organization</label>
                    <input type="text" value={signerOrg} onChange={(e) => setSignerOrg(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Signing Reason</label>
                    <input type="text" value={signReason} onChange={(e) => setSignReason(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Location</label>
                    <input type="text" value={signLocation} onChange={(e) => setSignLocation(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Certificate Passphrase</label>
                    <input
                      type="password"
                      value={certPassphrase}
                      onChange={(e) => setCertPassphrase(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      className="tool-btn"
                      style={{ flex: 1 }}
                      onClick={async () => {
                        const cert = await pdfApi.generateCert({
                          common_name: signerName,
                          organization: signerOrg,
                          passphrase: certPassphrase,
                        });
                        setGeneratedP12B64(cert.p12_base64);
                        notify(`Generated RSA-2048 X.509 Certificate (SHA256: ${cert.sha256_fingerprint.slice(0, 16)}...)`);
                      }}
                    >
                      Generate X.509 .p12
                    </button>
                    <button
                      className="tool-btn primary"
                      style={{ flex: 1 }}
                      onClick={async () => {
                        const res = await pdfApi.signCryptographic(activeDoc.doc_id, {
                          page_index: currentPage,
                          field_name: `Sig_${Date.now().toString().slice(-4)}`,
                          reason: signReason,
                          location: signLocation,
                          p12_base64: generatedP12B64 || undefined,
                          passphrase: certPassphrase,
                          signer_name: signerName,
                          organization: signerOrg,
                        });
                        setSigVerification(res.verification);
                        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                        notify(`Cryptographically signed PDF as ${res.signer_cn}.`);
                      }}
                    >
                      Sign Page Now
                    </button>
                  </div>

                  {sigVerification && (
                    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-color)' }}>
                      <div style={{ fontWeight: 600, marginBottom: 6 }}>
                        Cryptographic Verification ({sigVerification.signature_count})
                      </div>
                      {sigVerification.signatures.map((s, idx) => (
                        <div key={idx} style={{ fontSize: 11.5, marginBottom: 8 }}>
                          <span className={`badge ${s.intact && s.valid_digest ? 'pass' : 'fail'}`}>
                            {s.intact && s.valid_digest ? 'VALID CRYPTOGRAPHIC DIGEST' : 'TAMPERED / INVALID'}
                          </span>
                          <div style={{ marginTop: 4 }}>
                            <strong>Field:</strong> {s.field_name}
                          </div>
                          <div>
                            <strong>Subject:</strong> {s.signer_subject}
                          </div>
                          <div>
                            <strong>Reason:</strong> {s.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* SECURITY, ENCRYPTION & PERMANENT REDACTION INSPECTOR */}
              {mode === 'security' && activeDoc && (
                <>
                  <div className="inspector-section">
                    <h4>
                      <ShieldAlert size={14} /> Permanent Stream Redaction
                    </h4>
                    <div className="form-group">
                      <label>Search Terms (comma-separated)</label>
                      <input
                        type="text"
                        value={redactSearchTerms}
                        onChange={(e) => setRedactSearchTerms(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Regex Pattern (optional, e.g. \d{'{3}'}-\d{'{2}'}-\d{'{4}'})</label>
                      <input
                        type="text"
                        value={redactRegex}
                        onChange={(e) => setRedactRegex(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label>Redaction Overlay Label</label>
                      <input
                        type="text"
                        value={redactOverlayLabel}
                        onChange={(e) => setRedactOverlayLabel(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="inspector-section">
                    <h4>
                      <Lock size={14} /> AES-256 Encryption & Permissions
                    </h4>
                    <div className="form-group">
                      <label>User Open Password</label>
                      <input
                        type="password"
                        value={encUserPwd}
                        onChange={(e) => setEncUserPwd(e.target.value)}
                        placeholder="Required to open PDF..."
                      />
                    </div>
                    <div className="form-group">
                      <label>Owner Permissions Password</label>
                      <input
                        type="password"
                        value={encOwnerPwd}
                        onChange={(e) => setEncOwnerPwd(e.target.value)}
                        placeholder="Required to change permissions..."
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, fontSize: 12 }}>
                      <label>
                        <input
                          type="checkbox"
                          checked={encAllowPrint}
                          onChange={(e) => setEncAllowPrint(e.target.checked)}
                        />{' '}
                        Allow Printing
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={encAllowModify}
                          onChange={(e) => setEncAllowModify(e.target.checked)}
                        />{' '}
                        Allow Document Modification
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={encAllowExtract}
                          onChange={(e) => setEncAllowExtract(e.target.checked)}
                        />{' '}
                        Allow Text & Graphic Extraction
                      </label>
                    </div>
                    <button
                      className="tool-btn primary"
                      style={{ width: '100%' }}
                      onClick={async () => {
                        await pdfApi.encryptPdf(activeDoc.doc_id, {
                          user_password: encUserPwd,
                          owner_password: encOwnerPwd,
                          encryption_level: 'AES-256',
                          allow_print: encAllowPrint,
                          allow_modify: encAllowModify,
                          allow_extract: encAllowExtract,
                        });
                        await refreshDocState(activeDoc.doc_id, currentPage);
                        notify('Encrypted PDF with AES-256 (R=6) protection.');
                      }}
                    >
                      Apply AES-256 Encryption
                    </button>
                  </div>
                </>
              )}

              {/* PRO TOOLS, COMPARE & PREFLIGHT INSPECTOR */}
              {mode === 'pro' && activeDoc && (
                <>
                  <div className="inspector-section">
                    <h4>Watermark, Header/Footer & Bates</h4>
                    <div className="form-group">
                      <label>Watermark Text</label>
                      <input
                        type="text"
                        value={watermarkText}
                        onChange={(e) => setWatermarkText(e.target.value)}
                      />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Header Center</label>
                        <input
                          type="text"
                          value={headerCenter}
                          onChange={(e) => setHeaderCenter(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label>Footer Center</label>
                        <input
                          type="text"
                          value={footerCenter}
                          onChange={(e) => setFooterCenter(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Bates Prefix</label>
                        <input
                          type="text"
                          value={batesPrefix}
                          onChange={(e) => setBatesPrefix(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label>Start #</label>
                        <input
                          type="number"
                          value={batesStart}
                          onChange={(e) => setBatesStart(Number(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="inspector-section">
                    <h4>
                      <Columns size={14} /> Compare Two Open PDFs
                    </h4>
                    <div className="form-group">
                      <label>Compare Current Document Against:</label>
                      <select
                        value={compareTargetDocId}
                        onChange={(e) => setCompareTargetDocId(e.target.value)}
                      >
                        <option value="">-- Select Open Tab --</option>
                        {openDocs
                          .filter((d) => d.doc_id !== activeDoc.doc_id)
                          .map((d) => (
                            <option key={d.doc_id} value={d.doc_id}>
                              {d.filename}
                            </option>
                          ))}
                      </select>
                    </div>
                    <button
                      className="tool-btn primary"
                      style={{ width: '100%' }}
                      disabled={!compareTargetDocId}
                      onClick={async () => {
                        const cmp = await pdfApi.compareDocs(activeDoc.doc_id, compareTargetDocId);
                        setComparisonReport(cmp);
                      }}
                    >
                      Run Visual & Text Comparison
                    </button>
                  </div>

                  {preflightReport && (
                    <div className="inspector-section">
                      <h4>
                        Preflight & Accessibility ({preflightReport.score}%)
                      </h4>
                      {preflightReport.checks.map((chk) => (
                        <div key={chk.id} style={{ marginBottom: 6, fontSize: 11.5 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <strong>{chk.name}</strong>
                            <span
                              className={`badge ${
                                chk.status === 'pass' ? 'pass' : chk.status === 'fail' ? 'fail' : 'warn'
                              }`}
                            >
                              {chk.status.toUpperCase()}
                            </span>
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{chk.detail}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* DEFAULT DOCUMENT OVERVIEW CARD */}
              {activeDoc && (
                <div className="inspector-section">
                  <h4>Document Summary</h4>
                  <div style={{ fontSize: 11.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                    <div>
                      <strong>File:</strong> {activeDoc.filename}
                    </div>
                    <div>
                      <strong>Page {currentPage + 1} Size:</strong> {pageSizePt.width} × {pageSizePt.height} pt (
                      {activeDoc.pages[currentPage]?.width_mm} × {activeDoc.pages[currentPage]?.height_mm} mm)
                    </div>
                    <div>
                      <strong>Editable Spans on Page:</strong> {pageObjects?.text_spans.length || 0}
                    </div>
                    <div>
                      <strong>Embedded Images on Page:</strong> {pageObjects?.images.length || 0}
                    </div>
                    <div>
                      <strong>Hyperlinks on Page:</strong> {pageObjects?.links.length || 0}
                    </div>
                    <div>
                      <strong>Last Action:</strong> {activeDoc.last_action || 'Opened'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* 6. BOTTOM STATUS BAR */}
      <footer className="status-bar">
        <div className="status-group">
          <span>
            Engine:{' '}
            {engineState === 'ready' && (
              <strong style={{ color: 'var(--success, #10b981)' }}>
                PyMuPDF + pikepdf + pyHanko + RapidOCR Ready (Offline)
              </strong>
            )}
            {engineState === 'connecting' && (
              <strong style={{ color: 'var(--warning, #f59e0b)' }}>
                Connecting... ({connectionAttempt}/60)
              </strong>
            )}
            {engineState === 'error' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <strong style={{ color: 'var(--danger, #ef4444)' }}>
                  Connection Failed
                </strong>
                <button
                  type="button"
                  style={{
                    padding: '1px 8px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    background: '#3b82f6',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  onClick={() => connectToBackend(true)}
                  title="Retry connecting to Python backend"
                >
                  Retry
                </button>
                <button
                  type="button"
                  style={{
                    padding: '1px 8px',
                    fontSize: '11px',
                    borderRadius: '4px',
                    background: '#374151',
                    color: '#ffffff',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  onClick={async () => {
                    const status = await getDesktopBackendStatus();
                    if (status?.logs) setBackendLogs(status.logs);
                    setShowBackendDiag(true);
                  }}
                  title="View backend diagnostic logs"
                >
                  Diagnostics
                </button>
              </span>
            )}
          </span>
          {activeDoc && (
            <>
              <span>
                Page {currentPage + 1} of {activeDoc.page_count}
              </span>
              <span>
                {pageSizePt.width} × {pageSizePt.height} pt
              </span>
              <span>{(activeDoc.size_bytes / 1024).toFixed(1)} KB</span>
            </>
          )}
        </div>

        <div className="status-group">
          <span>Mode: {mode.toUpperCase()}</span>
          <span>Tool: {subTool}</span>
          <span>Zoom: {Math.round(zoom * 100)}%</span>
        </div>
      </footer>

      {/* MODAL: COMMAND PALETTE (Ctrl+K) */}
      {showCommandPalette && (
        <div className="modal-backdrop" onClick={() => setShowCommandPalette(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 540 }}>
            <div className="modal-header">
              <span>Command & Tool Palette</span>
              <button className="tab-close" onClick={() => setShowCommandPalette(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <input
                type="text"
                autoFocus
                placeholder="Type a command or tool name..."
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                style={{ marginBottom: 10 }}
              />
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {filteredCommands.map((cmd) => (
                  <button
                    key={cmd.id}
                    className="tool-btn"
                    style={{
                      width: '100%',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                      padding: '8px 10px',
                    }}
                    onClick={() => {
                      setShowCommandPalette(false);
                      setPaletteQuery('');
                      cmd.run();
                    }}
                  >
                    <span>{cmd.label}</span>
                    {cmd.shortcut && <span className="badge pass">{cmd.shortcut}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD HYPERLINK */}
      {linkDraftModal && (
        <div className="modal-backdrop" onClick={() => setLinkDraftModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
            <div className="modal-header">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <LinkIcon size={16} color="var(--primary)" />
                Add Hyperlink to Selection
              </span>
              <button className="tab-close" onClick={() => setLinkDraftModal(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 12, marginBottom: 10, color: 'var(--text-secondary)' }}>
                Target Area: [{linkDraftModal.bbox.map(Math.round).join(', ')}] pt on Page {currentPage + 1}
              </p>
              <div className="form-group">
                <label>Destination Web URL or URI</label>
                <input
                  type="url"
                  autoFocus
                  value={linkDraftModal.uri}
                  onChange={(e) => setLinkDraftModal({ ...linkDraftModal, uri: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCommitLinkDraft();
                    else if (e.key === 'Escape') setLinkDraftModal(null);
                  }}
                  placeholder="https://example.com"
                  style={{ width: '100%', fontSize: 13, padding: '7px 10px' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button className="tool-btn" onClick={() => setLinkDraftModal(null)}>
                  Cancel
                </button>
                <button className="tool-btn primary" onClick={handleCommitLinkDraft}>
                  Insert Hyperlink
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DOCUMENT PROPERTIES */}
      {showPropsModal && (
        <div className="modal-backdrop" onClick={() => setShowPropsModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
            <div className="modal-header">
              <span>Document Metadata & Properties</span>
              <button className="tab-close" onClick={() => setShowPropsModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {(['title', 'author', 'subject', 'keywords', 'creator', 'producer'] as const).map((k) => (
                <div key={k} className="form-group">
                  <label style={{ textTransform: 'capitalize' }}>{k}</label>
                  <input
                    type="text"
                    value={docPropsForm[k] || ''}
                    onChange={(e) => setDocPropsForm((prev) => ({ ...prev, [k]: e.target.value }))}
                  />
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button className="tool-btn" onClick={() => setShowPropsModal(false)}>
                  Cancel
                </button>
                <button className="tool-btn primary" onClick={handleSaveDocProperties}>
                  Save Metadata
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EXTRACTED TABLES PREVIEW & DOWNLOAD */}
      {extractedTables && activeDoc && (
        <div className="modal-backdrop" onClick={() => setExtractedTables(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span>Extracted PDF Tables ({extractedTables.tables.length})</span>
              <button className="tab-close" onClick={() => setExtractedTables(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  className="tool-btn primary"
                  onClick={() => window.open(`${getApiBaseUrl()}/api/docs/${activeDoc.doc_id}/export/xlsx`)}
                >
                  <Download size={14} /> Download Excel (.xlsx)
                </button>
                <button
                  className="tool-btn"
                  onClick={() => window.open(`${getApiBaseUrl()}/api/docs/${activeDoc.doc_id}/export/csv`)}
                >
                  <Download size={14} /> Download CSV (.csv)
                </button>
              </div>
              <pre
                style={{
                  background: 'var(--bg-app)',
                  padding: 10,
                  borderRadius: 6,
                  fontSize: 11.5,
                  overflowX: 'auto',
                }}
              >
                {extractedTables.csv_text}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: VISUAL & TEXT PDF COMPARISON */}
      {comparisonReport && (
        <div className="modal-backdrop" onClick={() => setComparisonReport(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 760 }}>
            <div className="modal-header">
              <span>
                PDF Comparison Report — Visual Similarity: {comparisonReport.overall_visual_similarity_percent}%
              </span>
              <button className="tab-close" onClick={() => setComparisonReport(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {comparisonReport.pages.map((pg) => (
                <div key={pg.page_index} className="inspector-section">
                  <h4>
                    Page {pg.page_number} — Similarity: {pg.visual_similarity_percent}% (Changed Area:{' '}
                    {pg.changed_area_percent}%)
                  </h4>
                  <div style={{ display: 'flex', gap: 12 }}>
                    {pg.diff_image_base64 && (
                      <img
                        src={`data:image/png;base64,${pg.diff_image_base64}`}
                        alt="Visual Diff"
                        style={{ width: 220, border: '1px solid var(--border-strong)', borderRadius: 4 }}
                      />
                    )}
                    <pre
                      style={{
                        flex: 1,
                        background: 'var(--bg-app)',
                        padding: 8,
                        borderRadius: 4,
                        fontSize: 11,
                        overflow: 'auto',
                        maxHeight: 260,
                      }}
                    >
                      {pg.unified_diff || 'No text differences on this page.'}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CRASH RECOVERY MANAGER */}
      {showRecoveryModal && (
        <div className="modal-backdrop" onClick={() => setShowRecoveryModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 520 }}>
            <div className="modal-header">
              <span>Crash Recovery Snapshots ({recoveryList.length})</span>
              <button className="tab-close" onClick={() => setShowRecoveryModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              {recoveryList.map((rec) => (
                <div
                  key={rec.doc_id}
                  className="inspector-section"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div>
                    <strong>{rec.filename}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      Last Action: {rec.last_action} • {rec.updated_at}
                    </div>
                  </div>
                  <button
                    className="tool-btn primary"
                    onClick={async () => {
                      const restored = await pdfApi.restoreRecovery(rec.doc_id);
                      setOpenDocs((prev) =>
                        prev.some((d) => d.doc_id === restored.doc_id) ? prev : [...prev, restored]
                      );
                      setActiveDocId(restored.doc_id);
                      setShowRecoveryModal(false);
                      notify(`Recovered session: ${restored.filename}`);
                    }}
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ABOUT */}
      {showAboutModal && (
        <div className="modal-backdrop" onClick={() => setShowAboutModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 540 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <VellumMarkIcon size={18} />
                <span style={{ fontWeight: 600 }}>About Vellum PDF Pro</span>
              </div>
              <button className="tab-close" onClick={() => setShowAboutModal(false)} title="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '14px 18px',
                  background: 'var(--bg-hover)',
                  borderRadius: 8,
                  border: '1px solid var(--border-color)',
                }}
              >
                <img
                  src={vellumAppIcon}
                  alt="Vellum PDF Pro Icon"
                  style={{
                    width: 64,
                    height: 64,
                    objectFit: 'contain',
                    flexShrink: 0,
                    filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.25))',
                  }}
                />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
                    Vellum PDF Pro
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, marginTop: 2 }}>
                    v1.0.0-beta.2 · Linux Desktop Edition
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 4 }}>
                    Free & Open Source Software · GNU AGPL-3.0
                  </div>
                </div>
              </div>

              <div>
                <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-primary)' }}>
                  A professional, offline-first Linux desktop PDF editor built with Electron, React, TypeScript,
                  and a high-performance Python 3.11 direct content stream editing engine.
                </p>
                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-secondary)' }}>
                  <strong>Core Engines:</strong> PyMuPDF (AGPL-3.0) · pikepdf/QPDF (MPL-2.0) · pyHanko (MIT) · RapidOCR (Apache-2.0) · ONNXRuntime (MIT) · pdf2docx (GPL-3.0) · ReportLab (BSD).
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-color)',
                  fontSize: 11.5,
                  color: 'var(--text-secondary)',
                }}
              >
                <span>© 2026 Vellum PDF Engineering · GNU AGPL-3.0</span>
                <button
                  className="btn"
                  onClick={() => setShowAboutModal(false)}
                  style={{ minWidth: 80, height: 28, fontSize: 12 }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: BACKEND DIAGNOSTICS */}
      {showBackendDiag && (
        <div className="modal-backdrop" onClick={() => setShowBackendDiag(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 620, maxHeight: '80vh' }}>
            <div className="modal-header">
              <span style={{ fontWeight: 600 }}>Backend Engine Diagnostics & Logs</span>
              <button className="tab-close" onClick={() => setShowBackendDiag(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <strong>Backend URL:</strong> <code>{getApiBaseUrl()}</code>
              </div>
              <div>
                <strong>Status:</strong>{' '}
                <span style={{ color: engineState === 'ready' ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                  {engineState.toUpperCase()}
                </span>
              </div>
              {backendErrorDetail && (
                <div style={{ background: '#451a1a', border: '1px solid #7f1d1d', borderRadius: 6, padding: '8px 12px', color: '#fca5a5', fontSize: 12 }}>
                  <strong>Diagnostic Detail:</strong> {backendErrorDetail}
                </div>
              )}
              <div>
                <strong style={{ fontSize: 12 }}>Recent Process Logs:</strong>
                <pre
                  style={{
                    background: '#090d16',
                    border: '1px solid #1e293b',
                    borderRadius: 6,
                    padding: 8,
                    fontSize: 11,
                    maxHeight: 240,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    color: '#94a3b8',
                    marginTop: 4,
                  }}
                >
                  {backendLogs.length > 0 ? backendLogs.join('\n') : 'No backend log events captured yet.'}
                </pre>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    const status = await getDesktopBackendStatus();
                    if (status?.logs) setBackendLogs(status.logs);
                  }}
                >
                  Refresh Logs
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    if (window.vellumDesktop?.restartBackend) {
                      notify('Restarting backend process...', 'info');
                      await window.vellumDesktop.restartBackend();
                    }
                    connectToBackend(true);
                  }}
                >
                  Restart Backend Process
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setShowBackendDiag(false);
                    connectToBackend(true);
                  }}
                >
                  Retry Connection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ENCRYPTED PDF PASSWORD UNLOCK */}
      {passwordPrompt && (
        <div className="modal-backdrop" onClick={() => setPasswordPrompt(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 440 }}>
            <div className="modal-header">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <KeyRound size={16} color="var(--primary)" />
                Password-Protected Document
              </span>
              <button className="tab-close" onClick={() => setPasswordPrompt(null)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 13, marginBottom: 12, color: 'var(--text-secondary)' }}>
                This PDF document is encrypted. Please enter the password to decrypt and view its contents.
              </p>
              {passwordPrompt.error && (
                <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 10, fontWeight: 500 }}>
                  {passwordPrompt.error}
                </div>
              )}
              <div className="form-group">
                <input
                  type="password"
                  placeholder="Enter PDF password..."
                  autoFocus
                  value={enteredPassword}
                  onChange={(e) => setEnteredPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUnlockEncryptedDoc();
                  }}
                  style={{ width: '100%', fontSize: 14, padding: '8px 12px' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button className="tool-btn" onClick={() => setPasswordPrompt(null)}>
                  Cancel
                </button>
                <button className="tool-btn primary" onClick={handleUnlockEncryptedDoc}>
                  Unlock PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

