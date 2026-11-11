import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  Bookmark,
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
  FormFieldItem,
  ImageObject,
  LeftSidebarTab,
  PageObjectsData,
  PreflightReport,
  SignatureVerificationReport,
  TextSpanObject,
  ThumbnailItem,
} from './types';

type SubTool =
  | 'select'
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
  | 'form-checkbox'
  | 'form-radio'
  | 'form-dropdown'
  | 'form-signature'
  | 'sig-visual'
  | 'sig-crypto'
  | 'redact-box';

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

  // Form Designer config
  const [newFieldName, setNewFieldName] = useState<string>('custom_field_1');
  const [newFieldDefault, setNewFieldDefault] = useState<string>('');
  const [newFieldChoices, setNewFieldChoices] = useState<string>('Option A, Option B, Option C');

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

  // Sync theme attribute on document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

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

        const [renderRes, objsRes, annotsRes, fieldsRes, thumbsRes, bmRes, attRes] = await Promise.all([
          pdfApi.renderPage(docId, safePage, Math.round(110 * Math.max(1, zoom))),
          pdfApi.getPageObjects(docId, safePage),
          pdfApi.listAnnotations(docId),
          pdfApi.listFormFields(docId),
          pdfApi.getThumbnails(docId, 52),
          pdfApi.getBookmarks(docId),
          pdfApi.listAttachments(docId),
        ]);

        setPageBitmap(`data:image/png;base64,${renderRes.image_base64}`);
        setPageSizePt({ width: renderRes.width_pt, height: renderRes.height_pt });
        setPageObjects(objsRes);
        setAnnotations(annotsRes);
        setFormFields(fieldsRes);
        const draftMap: Record<string, any> = {};
        fieldsRes.forEach((f) => {
          draftMap[f.field_name] = f.field_type === 'checkbox' ? f.checked : f.value;
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
        notify(`Failed to load initial document: ${docErr.message}`, 'error');
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
      notify('Backend connection could not be established. Click Retry in the status bar.', 'error');
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        if (document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave(e.shiftKey);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
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
          setShowSearch(true);
          break;
        case 'insert-blank-page':
          if (activeDoc) {
            try {
              const res = await pdfApi.insertBlankPage(activeDoc.doc_id, {
                target_page_index: currentPage + 1,
                page_count: 1,
              });
              setOpenDocs((prev) => prev.map((d) => (d.doc_id === activeDoc.doc_id ? res : d)));
              setCurrentPage((p) => p + 1);
              await refreshThumbnails(activeDoc.doc_id);
              await refreshDocState(activeDoc.doc_id);
            } catch (err: any) {
              setApiError(`Failed to insert blank page: ${err?.message || err}`);
            }
          }
          break;
        case 'rotate-page-cw':
          if (activeDoc) {
            try {
              const res = await pdfApi.rotatePages(activeDoc.doc_id, {
                page_indices: [currentPage],
                angle: 90,
              });
              setOpenDocs((prev) => prev.map((d) => (d.doc_id === activeDoc.doc_id ? res : d)));
              await refreshThumbnails(activeDoc.doc_id);
              await refreshDocState(activeDoc.doc_id);
            } catch (err: any) {
              setApiError(`Failed to rotate page: ${err?.message || err}`);
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
            handleCloseDoc(activeDocId);
          }
          break;
        case 'open-recovery':
          setShowRecoveryModal(true);
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

  // Interactive Canvas Rubber-Band / Freehand Mouse Handlers
  const toPdfCoords = (clientX: number, clientY: number, el: HTMLElement): [number, number] => {
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(pageSizePt.width, (clientX - rect.left) / zoom));
    const y = Math.max(0, Math.min(pageSizePt.height, (clientY - rect.top) / zoom));
    return [+(x.toFixed(1)), +(y.toFixed(1))];
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeDoc || subTool === 'select') return;
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
        const txt = window.prompt('Enter text for new PDF text block:', 'New PDF Text Block');
        if (txt) {
          const res = await pdfApi.addTextObject(activeDoc.doc_id, currentPage, {
            text: txt,
            bbox,
            font_name: toolFontName,
            font_size: toolFontSize,
            color_hex: toolColor,
          });
          await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
          notify('Inserted new text object into PDF content stream.');
        }
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
        const uri = window.prompt('Enter destination URL for hyperlink:', 'https://www.kernel.org');
        if (uri) {
          const res = await pdfApi.manageHyperlink(activeDoc.doc_id, currentPage, {
            action: 'add',
            bbox,
            uri,
          });
          await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
          notify(`Added hyperlink -> ${uri}`);
        }
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
        });
        await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
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
      className="app-shell"
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
          <div className="brand-badge">
            <FileCheck size={15} />
            <span>Vellum PDF Pro</span>
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
                  <span className="kbd">Ctrl+K</span>
                </button>
                <button onClick={() => setShowAboutModal(true)}>
                  <span>About Vellum PDF Pro & Licensing</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right side of Top Menu Bar: Search, Command Palette, Theme Toggle */}
        <div className="menubar-right">
          <form onSubmit={handleRunSearch} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search in PDF (Ctrl+F)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: 175, height: 24, fontSize: 11.5 }}
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
              {(
                [
                  ['select', 'Fill / Select Widgets'],
                  ['form-text', '+ Text Field'],
                  ['form-checkbox', '+ Checkbox'],
                  ['form-radio', '+ Radio Button'],
                  ['form-dropdown', '+ Dropdown'],
                  ['form-signature', '+ Signature Field'],
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
              <button
                className="tool-btn primary"
                onClick={async () => {
                  const res = await pdfApi.fillFormFields(activeDoc.doc_id, formDraftValues);
                  await refreshDocState(activeDoc.doc_id, currentPage, res.summary);
                  notify('Saved filled AcroForm field values into PDF stream.');
                }}
              >
                <CheckCircle2 size={14} /> Save Filled Form Values
              </button>
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
                      const res = await pdfApi.decryptPdf(activeDoc.doc_id, { password: '' });
                      await refreshDocState(activeDoc.doc_id, currentPage, res);
                      notify('Removed password encryption from this document.');
                    } catch (err: any) {
                      setApiError(`Failed to decrypt document: ${err?.message || err}`);
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

                {/* Direct PDF Text Spans & Images Overlay (Active in Edit Mode) */}
                {mode === 'edit' &&
                  subTool === 'select' &&
                  pageObjects?.text_spans.map((sp) => (
                    <div
                      key={sp.id}
                      className={`span-box ${selectedSpan?.id === sp.id ? 'selected' : ''}`}
                      style={{
                        left: `${sp.bbox[0] * zoom}px`,
                        top: `${sp.bbox[1] * zoom}px`,
                        width: `${Math.max(12, (sp.bbox[2] - sp.bbox[0]) * zoom)}px`,
                        height: `${Math.max(10, (sp.bbox[3] - sp.bbox[1]) * zoom)}px`,
                      }}
                      title={`Click to edit PDF text span: "${sp.text}" (${sp.font}, ${sp.size}pt)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedSpan(sp);
                        setSelectedImage(null);
                        setSelectedAnnot(null);
                        setSelectedField(null);
                      }}
                    />
                  ))}

                {mode === 'edit' &&
                  subTool === 'select' &&
                  pageObjects?.images.map((im) => (
                    <div
                      key={im.id}
                      className={`image-box ${selectedImage?.id === im.id ? 'selected' : ''}`}
                      style={{
                        left: `${im.bbox[0] * zoom}px`,
                        top: `${im.bbox[1] * zoom}px`,
                        width: `${Math.max(16, (im.bbox[2] - im.bbox[0]) * zoom)}px`,
                        height: `${Math.max(16, (im.bbox[3] - im.bbox[1]) * zoom)}px`,
                      }}
                      title={`Click to transform/replace/delete embedded PDF image (xref=${im.xref}, ${im.width}×${im.height}px)`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedImage(im);
                        setSelectedSpan(null);
                        setSelectedAnnot(null);
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
                  pageFormFields.map((fld) => (
                    <div
                      key={fld.xref}
                      className={`form-widget-box ${selectedField?.xref === fld.xref ? 'selected' : ''}`}
                      style={{
                        left: `${fld.bbox[0] * zoom}px`,
                        top: `${fld.bbox[1] * zoom}px`,
                        width: `${Math.max(20, (fld.bbox[2] - fld.bbox[0]) * zoom)}px`,
                        height: `${Math.max(18, (fld.bbox[3] - fld.bbox[1]) * zoom)}px`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedField(fld);
                      }}
                    >
                      {fld.field_type === 'checkbox' || fld.field_type === 'radiobutton' ? (
                        <input
                          type="checkbox"
                          checked={Boolean(formDraftValues[fld.field_name])}
                          onChange={(e) =>
                            setFormDraftValues((prev) => ({
                              ...prev,
                              [fld.field_name]: e.target.checked,
                            }))
                          }
                          style={{ width: '100%', height: '100%', cursor: 'pointer' }}
                        />
                      ) : fld.field_type === 'dropdown' ? (
                        <select
                          value={String(formDraftValues[fld.field_name] ?? fld.value)}
                          onChange={(e) =>
                            setFormDraftValues((prev) => ({
                              ...prev,
                              [fld.field_name]: e.target.value,
                            }))
                          }
                          style={{ width: '100%', height: '100%', fontSize: 11, padding: 1 }}
                        >
                          {fld.choices.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={String(formDraftValues[fld.field_name] ?? fld.value)}
                          onChange={(e) =>
                            setFormDraftValues((prev) => ({
                              ...prev,
                              [fld.field_name]: e.target.value,
                            }))
                          }
                          style={{
                            width: '100%',
                            height: '100%',
                            fontSize: `${Math.max(10, fld.text_fontsize * zoom * 0.85)}px`,
                            padding: '1px 4px',
                            background: 'rgba(255,255,255,0.88)',
                            color: '#0f172a',
                            border: 'none',
                          }}
                        />
                      )}
                    </div>
                  ))}

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
        </main>

        {/* 5. RIGHT CONTEXT-SENSITIVE PROPERTIES INSPECTOR */}
        {rightOpen && (
          <aside className="right-inspector">
            <div className="panel-header">
              <span>Properties & Inspector</span>
              <span className="badge pass">{mode.toUpperCase()}</span>
            </div>

            <div className="panel-scroll">
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
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 500 }}>
            <div className="modal-header">
              <span>About Vellum PDF Pro (Linux Desktop Edition)</span>
              <button className="tab-close" onClick={() => setShowAboutModal(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ lineHeight: 1.6 }}>
              <p style={{ marginBottom: 8 }}>
                <strong>Vellum PDF Pro v1.0.0</strong> is an offline-first Linux desktop PDF editor built with
                Electron, React, TypeScript, and a hybrid Python 3.11 native PDF engine.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                <strong>Engines:</strong> PyMuPDF (AGPL-3.0), pikepdf/QPDF (MPL-2.0), pyHanko (MIT),
                RapidOCR/ONNXRuntime (Apache-2.0), pdfplumber (MIT), LibreOffice & Ghostscript.
              </p>
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

