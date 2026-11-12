import {
  AnnotationItem,
  AttachmentItem,
  BookmarkItem,
  ComparisonReport,
  DocumentSummary,
  FontItem,
  FormFieldItem,
  PageObjectsData,
  PreflightReport,
  SignatureVerificationReport,
  ThumbnailItem,
} from './types';

let resolvedBaseUrl = 'http://127.0.0.1:18420';

export async function initApiBaseUrl(): Promise<string> {
  if (window.vellumDesktop?.getBackendUrl) {
    try {
      const url = await window.vellumDesktop.getBackendUrl();
      if (url) resolvedBaseUrl = url;
    } catch {
      // Fallback to default local port
    }
  }
  return resolvedBaseUrl;
}

export function getApiBaseUrl(): string {
  return resolvedBaseUrl;
}

export async function checkBackendHealth(timeoutMs = 1500): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${resolvedBaseUrl}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function getDesktopBackendStatus(): Promise<any> {
  if (window.vellumDesktop?.getBackendStatus) {
    try {
      return await window.vellumDesktop.getBackendStatus();
    } catch {
      return null;
    }
  }
  return null;
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${resolvedBaseUrl}${path}`, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = await res.json();
      detail = errJson.detail || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const pdfApi = {
  getHealth: () => requestJson<any>('/api/health'),
  listOpenDocs: () => requestJson<DocumentSummary[]>('/api/docs'),
  createNewDoc: (filename = 'Untitled.pdf', width = 595, height = 842, page_count = 1) =>
    requestJson<DocumentSummary>('/api/docs/new', {
      method: 'POST',
      body: JSON.stringify({ filename, width, height, page_count }),
    }),
  openSampleDoc: () =>
    requestJson<DocumentSummary>('/api/docs/sample', { method: 'POST' }),
  openByPath: (file_path: string, password?: string) =>
    requestJson<DocumentSummary>('/api/docs/open-path', {
      method: 'POST',
      body: JSON.stringify({ file_path, password }),
    }),
  openUpload: (file: File, password?: string, filePath?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (password) fd.append('password', password);
    if (filePath) fd.append('file_path', filePath);
    return requestJson<DocumentSummary>('/api/docs/open-upload', {
      method: 'POST',
      body: fd,
    });
  },
  getDocSummary: (docId: string) => requestJson<DocumentSummary>(`/api/docs/${docId}`),
  saveDoc: (docId: string, target_path?: string, create_backup = true) =>
    requestJson<{ saved_path: string; backup_path: string | null; summary: DocumentSummary }>(
      `/api/docs/${docId}/save`,
      {
        method: 'POST',
        body: JSON.stringify({ target_path, create_backup }),
      }
    ),
  closeDoc: (docId: string) =>
    requestJson<{ closed: string }>(`/api/docs/${docId}`, { method: 'DELETE' }),
  undo: (docId: string) =>
    requestJson<{ undone_action: string | null; summary: DocumentSummary }>(
      `/api/docs/${docId}/undo`,
      { method: 'POST' }
    ),
  redo: (docId: string) =>
    requestJson<{ redone_action: string | null; summary: DocumentSummary }>(
      `/api/docs/${docId}/redo`,
      { method: 'POST' }
    ),
  listRecovery: () => requestJson<any[]>('/api/recovery'),
  restoreRecovery: (docId: string) =>
    requestJson<DocumentSummary>(`/api/recovery/${docId}/restore`, { method: 'POST' }),
  discardRecovery: (docId: string) =>
    requestJson<{ discarded: string }>(`/api/recovery/${docId}`, { method: 'DELETE' }),

  // Rendering & Search
  renderPage: (docId: string, pageIndex: number, dpi = 144) =>
    requestJson<{
      page_index: number;
      width_pt: number;
      height_pt: number;
      pixel_width: number;
      pixel_height: number;
      dpi: number;
      rotation: number;
      image_base64: string;
    }>(`/api/docs/${docId}/pages/${pageIndex}/render?dpi=${dpi}`),
  getThumbnails: (docId: string, dpi = 54) =>
    requestJson<ThumbnailItem[]>(`/api/docs/${docId}/thumbnails?dpi=${dpi}`),
  searchDoc: (docId: string, query: string) =>
    requestJson<{
      query: string;
      total_matches: number;
      matches: Array<{ page_index: number; page_number: number; bbox: [number, number, number, number] }>;
    }>(`/api/docs/${docId}/search`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    }),

  // Direct PDF Content Editing
  getPageObjects: (docId: string, pageIndex: number) =>
    requestJson<PageObjectsData>(`/api/docs/${docId}/pages/${pageIndex}/objects`),
  editTextSpan: (docId: string, pageIndex: number, payload: any) =>
    requestJson<{
      summary: DocumentSummary;
      objects: PageObjectsData;
      edit_method: string;
      whiteout_used: boolean;
      fallback_used: boolean;
      fallback_reason: string;
      applied_font: string;
    }>(`/api/docs/${docId}/pages/${pageIndex}/edit-text`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addTextObject: (docId: string, pageIndex: number, payload: any) =>
    requestJson<{ summary: DocumentSummary; objects: PageObjectsData }>(
      `/api/docs/${docId}/pages/${pageIndex}/add-text`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  insertImage: (docId: string, pageIndex: number, file: File, bbox: [number, number, number, number], rotation = 0) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('x0', String(bbox[0]));
    fd.append('y0', String(bbox[1]));
    fd.append('x1', String(bbox[2]));
    fd.append('y1', String(bbox[3]));
    fd.append('rotation', String(rotation));
    return requestJson<{ summary: DocumentSummary; objects: PageObjectsData }>(
      `/api/docs/${docId}/pages/${pageIndex}/insert-image`,
      {
        method: 'POST',
        body: fd,
      }
    );
  },
  editImage: (docId: string, pageIndex: number, payload: any) =>
    requestJson<{ summary: DocumentSummary; objects: PageObjectsData }>(
      `/api/docs/${docId}/pages/${pageIndex}/edit-image`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  addShape: (docId: string, pageIndex: number, payload: any) =>
    requestJson<{ summary: DocumentSummary; objects: PageObjectsData }>(
      `/api/docs/${docId}/pages/${pageIndex}/add-shape`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  transformObject: (docId: string, pageIndex: number, payload: any) =>
    requestJson<{ summary: DocumentSummary; objects: PageObjectsData }>(
      `/api/docs/${docId}/pages/${pageIndex}/transform-object`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  manageHyperlink: (docId: string, pageIndex: number, payload: any) =>
    requestJson<{ summary: DocumentSummary; objects: PageObjectsData }>(
      `/api/docs/${docId}/pages/${pageIndex}/hyperlink`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Page Management
  insertBlankPage: (docId: string, index = -1, width?: number, height?: number) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pages/insert-blank`, {
      method: 'POST',
      body: JSON.stringify({ index, width, height }),
    }),
  deletePages: (docId: string, page_indices: number[], range_spec?: string) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pages/delete`, {
      method: 'POST',
      body: JSON.stringify({ page_indices, range_spec }),
    }),
  duplicatePage: (docId: string, page_index: number) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pages/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ page_index }),
    }),
  extractPages: (docId: string, page_indices: number[], range_spec?: string) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pages/extract?open_as_tab=true`, {
      method: 'POST',
      body: JSON.stringify({ page_indices, range_spec }),
    }),
  reorderPages: (docId: string, new_order: number[]) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pages/reorder`, {
      method: 'POST',
      body: JSON.stringify({ new_order }),
    }),
  rotatePages: (docId: string, page_indices: number[], delta_degrees = 90) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pages/rotate`, {
      method: 'POST',
      body: JSON.stringify({ page_indices, delta_degrees }),
    }),
  cropPage: (docId: string, payload: any) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pages/crop`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  resizePages: (docId: string, payload: any) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pages/resize`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  insertPagesFromPdf: (docId: string, file: File, insertAtIndex = -1, sourceRange?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('insert_at_index', String(insertAtIndex));
    if (sourceRange) fd.append('source_range', sourceRange);
    return requestJson<DocumentSummary>(`/api/docs/${docId}/pages/insert-from-pdf`, {
      method: 'POST',
      body: fd,
    });
  },
  mergeOpenDocs: (doc_ids: string[], output_filename = 'Merged_Document.pdf') =>
    requestJson<DocumentSummary>('/api/docs/merge', {
      method: 'POST',
      body: JSON.stringify({ doc_ids, output_filename }),
    }),
  splitPdf: (docId: string, mode: string, ranges_spec: string, every_n_pages = 1) =>
    requestJson<{ split_count: number; created_tabs: DocumentSummary[]; zip_base64: string }>(
      `/api/docs/${docId}/pages/split?open_tabs=true`,
      {
        method: 'POST',
        body: JSON.stringify({ mode, ranges_spec, every_n_pages }),
      }
    ),

  // Annotations
  listAnnotations: (docId: string) => requestJson<AnnotationItem[]>(`/api/docs/${docId}/annotations`),
  addAnnotation: (docId: string, payload: any) =>
    requestJson<{ summary: DocumentSummary; annotations: AnnotationItem[] }>(
      `/api/docs/${docId}/annotations`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  updateAnnotation: (docId: string, xref: number, payload: any) =>
    requestJson<{ summary: DocumentSummary; annotations: AnnotationItem[] }>(
      `/api/docs/${docId}/annotations/${xref}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  deleteAnnotation: (docId: string, xref: number, pageIndex: number) =>
    requestJson<{ summary: DocumentSummary; annotations: AnnotationItem[] }>(
      `/api/docs/${docId}/annotations/${xref}?page_index=${pageIndex}`,
      { method: 'DELETE' }
    ),

  // Forms & Signatures
  listFormFields: (docId: string) => requestJson<FormFieldItem[]>(`/api/docs/${docId}/forms`),
  createFormField: (docId: string, payload: any) =>
    requestJson<{ summary: DocumentSummary; fields: FormFieldItem[] }>(
      `/api/docs/${docId}/forms/create`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  fillFormFields: (docId: string, values: Record<string, any>, page_index?: number) =>
    requestJson<{ summary: DocumentSummary; fields: FormFieldItem[] }>(
      `/api/docs/${docId}/forms/fill`,
      {
        method: 'POST',
        body: JSON.stringify({ values, page_index }),
      }
    ),
  updateFormField: (docId: string, xref: number, payload: any) =>
    requestJson<{ summary: DocumentSummary; fields: FormFieldItem[] }>(
      `/api/docs/${docId}/forms/${xref}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  deleteFormField: (docId: string, xref: number, pageIndex: number) =>
    requestJson<{ summary: DocumentSummary; fields: FormFieldItem[] }>(
      `/api/docs/${docId}/forms/${xref}?page_index=${pageIndex}`,
      { method: 'DELETE' }
    ),
  applyVisualSignature: (docId: string, payload: any) =>
    requestJson<{ summary: DocumentSummary; signature_kind: string; cryptographic: boolean; notice: string }>(
      `/api/docs/${docId}/signatures/visual`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  generateCert: (payload: any) =>
    requestJson<any>('/api/signatures/generate-cert', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  signCryptographic: (docId: string, payload: any) =>
    requestJson<{
      summary: DocumentSummary;
      signature_kind: string;
      cryptographic: boolean;
      field_name: string;
      signer_cn: string;
      signer_org: string;
      signed_at: string;
      certificate_sha256: string;
      verification: SignatureVerificationReport;
    }>(`/api/docs/${docId}/signatures/cryptographic`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  verifySignatures: (docId: string) =>
    requestJson<SignatureVerificationReport>(`/api/docs/${docId}/signatures/verify`),

  // OCR & Conversions
  runOcr: (docId: string, payload: any) =>
    requestJson<{
      summary: DocumentSummary;
      language: string;
      engine: string;
      total_lines_added: number;
      pages: any[];
    }>(`/api/docs/${docId}/ocr`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  extractTablesJson: (docId: string) =>
    requestJson<{ tables_count: number; tables: any[]; csv_text: string; xlsx_base64: string }>(
      `/api/docs/${docId}/export/tables-json`,
      { method: 'POST' }
    ),
  convertDocxToPdf: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('open_as_tab', 'true');
    return requestJson<DocumentSummary>('/api/convert/docx-to-pdf', {
      method: 'POST',
      body: fd,
    });
  },
  convertImagesToPdf: (files: File[], pageSize = 'fit_image') => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('page_size', pageSize);
    fd.append('open_as_tab', 'true');
    return requestJson<DocumentSummary>('/api/convert/images-to-pdf', {
      method: 'POST',
      body: fd,
    });
  },

  // Security & Optimization
  encryptPdf: (docId: string, payload: any) =>
    requestJson<{
      encrypted: boolean;
      encryption_level: string;
      encrypted_size_bytes: number;
      encrypted_base64: string;
    }>(`/api/docs/${docId}/security/encrypt`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  decryptPdf: (docId: string, password = '') =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/security/decrypt`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  redactPdf: (docId: string, payload: any) =>
    requestJson<{
      summary: DocumentSummary;
      redacted_regions_count: number;
      pages_affected: number[];
      permanent_stream_purge: boolean;
    }>(`/api/docs/${docId}/security/redact`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sanitizePdf: (docId: string) =>
    requestJson<{ summary: DocumentSummary; removed_metadata: Record<string, string>; xmp_stripped: boolean }>(
      `/api/docs/${docId}/security/sanitize`,
      { method: 'POST' }
    ),
  getProperties: (docId: string) => requestJson<any>(`/api/docs/${docId}/properties`),
  setProperties: (docId: string, payload: any) =>
    requestJson<{ summary: DocumentSummary; properties: any }>(`/api/docs/${docId}/properties`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  optimizePdf: (docId: string, payload: any) =>
    requestJson<{
      summary: DocumentSummary;
      original_size_bytes: number;
      optimized_size_bytes: number;
      saved_bytes: number;
      savings_percent: number;
      images_optimized: number;
    }>(`/api/docs/${docId}/optimize`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getFonts: (docId: string) => requestJson<FontItem[]>(`/api/docs/${docId}/fonts`),
  repairPdf: (docId: string) =>
    requestJson<{ summary: DocumentSummary; repaired: boolean; diagnostics: string[] }>(
      `/api/docs/${docId}/repair`,
      { method: 'POST' }
    ),

  // Pro Features
  compareDocs: (doc_id_a: string, doc_id_b: string) =>
    requestJson<ComparisonReport>('/api/docs/compare', {
      method: 'POST',
      body: JSON.stringify({ doc_id_a, doc_id_b }),
    }),
  applyHeaderFooter: (docId: string, payload: any) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pro/header-footer`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  applyWatermark: (docId: string, payload: any) =>
    requestJson<DocumentSummary>(`/api/docs/${docId}/pro/watermark`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  applyBates: (docId: string, payload: any) =>
    requestJson<{
      summary: DocumentSummary;
      first_bates: string;
      last_bates: string;
      next_number: number;
      count: number;
    }>(`/api/docs/${docId}/pro/bates`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getBookmarks: (docId: string) => requestJson<BookmarkItem[]>(`/api/docs/${docId}/bookmarks`),
  addBookmark: (docId: string, title: string, page_index: number, level = 1) =>
    requestJson<{ summary: DocumentSummary; bookmarks: BookmarkItem[] }>(
      `/api/docs/${docId}/bookmarks`,
      {
        method: 'POST',
        body: JSON.stringify({ title, page_index, level }),
      }
    ),
  deleteBookmark: (docId: string, index: number) =>
    requestJson<{ summary: DocumentSummary; bookmarks: BookmarkItem[] }>(
      `/api/docs/${docId}/bookmarks/${index}`,
      { method: 'DELETE' }
    ),
  listAttachments: (docId: string) => requestJson<AttachmentItem[]>(`/api/docs/${docId}/attachments`),
  addAttachment: (docId: string, file: File, description = '') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('description', description);
    return requestJson<{ summary: DocumentSummary; attachments: AttachmentItem[] }>(
      `/api/docs/${docId}/attachments`,
      {
        method: 'POST',
        body: fd,
      }
    );
  },
  deleteAttachment: (docId: string, name: string) =>
    requestJson<{ summary: DocumentSummary; attachments: AttachmentItem[] }>(
      `/api/docs/${docId}/attachments/${encodeURIComponent(name)}`,
      { method: 'DELETE' }
    ),
  runPreflight: (docId: string) => requestJson<PreflightReport>(`/api/docs/${docId}/pro/preflight`),
  convertPdfA: (docId: string, conformance = '2B', language = 'en-US', title?: string) =>
    requestJson<{
      summary: DocumentSummary;
      is_pdfa: boolean;
      pdfa_conformance: string;
      preflight_score: number;
      inspection: PreflightReport;
    }>(`/api/docs/${docId}/pro/pdfa`, {
      method: 'POST',
      body: JSON.stringify({ conformance, language, title }),
    }),
};

