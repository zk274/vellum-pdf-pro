export type EditorMode =
  | 'view'
  | 'edit'
  | 'annotate'
  | 'pages'
  | 'forms'
  | 'sign'
  | 'ocr'
  | 'security'
  | 'pro';

export type LeftSidebarTab = 'thumbnails' | 'bookmarks' | 'comments' | 'attachments' | 'fonts';

export interface PageInfo {
  page_index: number;
  page_number: number;
  width_pt: number;
  height_pt: number;
  width_mm: number;
  height_mm: number;
  rotation: number;
}

export interface DocumentSummary {
  doc_id: string;
  filename: string;
  file_path: string | null;
  page_count: number;
  pages: PageInfo[];
  metadata: Record<string, string>;
  bookmarks_count: number;
  is_encrypted: boolean;
  dirty: boolean;
  size_bytes: number;
  sha256: string;
  can_undo: boolean;
  can_redo: boolean;
  undo_count: number;
  redo_count: number;
  last_action: string | null;
  updated_at: string;
}

export interface ThumbnailItem {
  page_index: number;
  page_number: number;
  width_pt: number;
  height_pt: number;
  rotation: number;
  image_base64: string;
}

export interface TextSpanObject {
  id: string;
  block_index: number;
  line_index: number;
  span_index: number;
  text: string;
  bbox: [number, number, number, number];
  origin: [number, number];
  font: string;
  family: 'sans' | 'serif' | 'mono';
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  is_subset_font: boolean;
  can_edit_losslessly: boolean;
}

export interface ImageObject {
  id: string;
  image_index: number;
  xref: number;
  bbox: [number, number, number, number];
  width: number;
  height: number;
  colorspace: string;
  bpc: number;
  thumbnail_base64: string | null;
}

export interface LinkObject {
  id: string;
  link_index: number;
  kind: number;
  uri: string;
  target_page: number;
  bbox: [number, number, number, number];
}

export interface VellumBoxObject {
  id: string;
  type: 'textbox';
  text: string;
  bbox: [number, number, number, number];
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right' | 'justify';
  background_hex?: string | null;
  border_hex?: string | null;
  border_width?: number;
}

export interface VellumShapeObject {
  id: string;
  type: 'shape';
  shape_type: 'rect' | 'ellipse' | 'line' | 'arrow';
  bbox: [number, number, number, number];
  stroke_hex: string;
  fill_hex?: string | null;
  stroke_width: number;
  opacity: number;
  rotation?: number;
}

export interface TransformObjectRequest {
  object_id: string;
  object_type: 'textbox' | 'shape' | 'image' | 'text_span';
  action: 'transform' | 'delete' | 'duplicate' | 'update_style';
  orig_bbox: [number, number, number, number];
  new_bbox?: [number, number, number, number] | null;
  orig_origin?: [number, number] | null;
  text?: string;
  font_name?: string;
  font_size?: number;
  color_hex?: string;
  bold?: boolean;
  italic?: boolean;
  align?: string;
  shape_type?: string;
  stroke_hex?: string;
  fill_hex?: string | null;
  stroke_width?: number;
  opacity?: number;
  rotation?: number;
  image_xref?: number;
}

export interface SelectedManipulableObject {
  id: string;
  type: 'textbox' | 'shape' | 'image' | 'text_span';
  bbox: [number, number, number, number];
  data: VellumBoxObject | VellumShapeObject | ImageObject | TextSpanObject;
}

export interface TextRun {
  text: string;
  font: string;
  family?: 'sans' | 'serif' | 'mono';
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  is_embedded_font?: boolean;
  is_subset_font?: boolean;
  char_spacing?: number;
  baseline?: number;
  link_uri?: string | null;
}

export interface FontWarningInfo {
  original_font: string;
  fallback_font: string;
  reason: string;
}

export interface TextBlockObject {
  id: string;
  block_index: number;
  bbox: [number, number, number, number];
  text: string;
  reflow_text?: string;
  runs?: TextRun[];
  span_ids: string[];
  line_bboxes?: Array<[number, number, number, number]>;
  first_origin?: [number, number];
  dominant_font?: string;
  dominant_size?: number;
  dominant_color?: string;
  bold?: boolean;
  italic?: boolean;
  line_height?: number;
  align?: 'left' | 'center' | 'right' | 'justify';
  is_mixed_style?: boolean;
  has_subset_font?: boolean;
  horizontal?: boolean;
}

export interface EditParagraphRequest {
  block_id?: string | null;
  orig_bbox: [number, number, number, number];
  expected_orig_text: string;
  new_text: string;
  target_bbox?: [number, number, number, number] | null;
  font_name?: string | null;
  font_size?: number | null;
  color_hex?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  align?: 'left' | 'center' | 'right' | 'justify';
  line_height?: number;
  keep_original_font?: boolean;
  overflow_policy?: 'check' | 'expand_box' | 'shrink_font' | 'force';
  runs?: TextRun[] | null;
  font_fallback_policy?: 'warn_and_fallback' | 'refuse';
}

export interface ParagraphOverflowInfo {
  required_height: number;
  available_height: number;
  max_safe_expand_height: number;
  can_expand_safely: boolean;
  collides_with_neighbors: boolean;
  suggested_font_size: number | null;
  min_readable_font_size?: number;
  wrapped_line_count: number;
  message?: string;
}

export interface EditParagraphResponse {
  status: 'ok' | 'overflow';
  summary: DocumentSummary;
  objects?: PageObjectsData;
  overflow_info?: ParagraphOverflowInfo;
  font_strategy?: string;
  fallback_used?: boolean;
  fallback_reason?: string;
  font_warnings?: FontWarningInfo[];
  applied_font?: string;
  final_bbox?: [number, number, number, number];
  final_font_size?: number;
  wrapped_line_count?: number;
}

export interface PageObjectsData {
  page_index: number;
  width: number;
  height: number;
  rotation: number;
  text_spans: TextSpanObject[];
  text_blocks?: TextBlockObject[];
  images: ImageObject[];
  links: LinkObject[];
  vector_drawings_count: number;
  vellum_boxes?: VellumBoxObject[];
  vellum_shapes?: VellumShapeObject[];
}

export interface AnnotationItem {
  xref: number;
  page_index: number;
  page_number: number;
  type: string;
  bbox: [number, number, number, number];
  content: string;
  author: string;
  subject: string;
  created_at: string;
  modified_at: string;
  color: string;
  opacity: number;
}

export interface FormFieldItem {
  xref: number;
  page_index: number;
  page_number: number;
  field_name: string;
  field_label: string;
  field_type: 'text' | 'checkbox' | 'radiobutton' | 'dropdown' | 'listbox' | 'signature' | string;
  value: string | boolean;
  checked: boolean;
  export_value?: string;
  choices: string[];
  bbox: [number, number, number, number];
  text_fontsize: number;
  text_font?: string;
  text_color: string;
  fill_color: string | null;
  border_color: string | null;
  is_signed: boolean;
  read_only: boolean;
  required?: boolean;
  multiline?: boolean;
  password_field?: boolean;
  text_maxlen?: number;
  align?: 'left' | 'center' | 'right' | string;
  tab_order?: number;
  has_appearance?: boolean;
}

export interface FormInspectionReport {
  acroform_present: boolean;
  is_xfa: boolean;
  xfa_notice: string | null;
  field_count: number;
  fields: FormFieldItem[];
}

export interface FormFieldCandidate {
  id: string;
  page_index: number;
  field_type: 'text' | 'multiline' | 'checkbox' | string;
  field_name: string;
  label: string;
  bbox: [number, number, number, number];
  confidence: number;
  accepted?: boolean;
}

export interface FormFillWarning {
  field_name: string;
  xref: number;
  code: 'read_only' | 'max_length_exceeded' | 'auto_fitted' | 'text_overflow' | string;
  message: string;
}

export interface TextBoxDefaults {
  color: string;
  font: string;
  size: number;
  align: 'left' | 'center' | 'right' | 'justify';
  bg_hex: string; // 'transparent' or '#rrggbb'
  border_hex: string; // 'transparent' or '#rrggbb'
}

export interface BookmarkItem {
  index: number;
  level: number;
  title: string;
  page_number: number;
  page_index: number;
}

export interface AttachmentItem {
  name: string;
  filename: string;
  description: string;
  size_bytes: number;
}

export interface FontItem {
  xref: number;
  name: string;
  resource_name: string;
  type: string;
  encoding: string;
  extension: string;
  is_embedded: boolean;
  is_subset: boolean;
  first_seen_page: number;
}

export interface SignatureVerificationReport {
  has_cryptographic_signatures: boolean;
  signature_count: number;
  all_intact: boolean;
  signatures: Array<{
    field_name: string;
    cryptographic: boolean;
    intact: boolean;
    valid_digest: boolean;
    entire_file_covered: boolean;
    tampered: boolean;
    coverage_level: string;
    signer_subject: string;
    signer_issuer: string;
    serial_number: string;
    certificate_sha256: string;
    reason: string;
    location: string;
    byte_range: number[];
    summary: string;
  }>;
}

export interface PreflightReport {
  score: number;
  pdf_version: string;
  is_pdfa: boolean;
  pdfa_conformance: string;
  is_tagged: boolean;
  has_language: boolean;
  total_characters: number;
  total_images: number;
  unembedded_fonts: string[];
  checks: Array<{
    id: string;
    category: string;
    name: string;
    status: 'pass' | 'warn' | 'fail' | 'info';
    detail: string;
  }>;
}

export interface ComparisonReport {
  doc_a_pages: number;
  doc_b_pages: number;
  compared_pages: number;
  overall_visual_similarity_percent: number;
  has_differences: boolean;
  pages: Array<{
    page_index: number;
    page_number: number;
    text_identical: boolean;
    added_lines: string[];
    removed_lines: string[];
    unified_diff: string;
    visual_similarity_percent: number;
    changed_area_percent: number;
    diff_image_base64: string;
  }>;
}

declare global {
  interface Window {
    vellumDesktop?: {
      isDesktopApp: boolean;
      platform: string;
      getBackendUrl: () => Promise<string>;
      getBackendStatus: () => Promise<{
        started: boolean;
        ready: boolean;
        port: number;
        url: string;
        pid: number | null;
        exitCode: number | null;
        error: string | null;
        logs: string[];
      }>;
      restartBackend: () => Promise<{ ready: boolean; url: string }>;
      openFileDialog: () => Promise<string | null>;
      saveFileDialog: (defaultFilename?: string) => Promise<string | null>;
      printDocument: () => Promise<{ printed: boolean }>;
      minimizeWindow?: () => Promise<void>;
      toggleMaximizeWindow?: () => Promise<boolean>;
      closeWindow?: () => Promise<void>;
      isWindowMaximized?: () => Promise<boolean>;
      onWindowStateChange?: (cb: (state: { isMaximized: boolean }) => void) => () => void;
      onMenuAction: (cb: (payload: { action: string; [key: string]: any }) => void) => () => void;
    };
  }
}

