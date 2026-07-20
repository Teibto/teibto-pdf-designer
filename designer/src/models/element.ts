/**
 * Canvas Element Models
 * Defines all element types that can be placed on the PDF canvas.
 *
 * @author Wichit Wongta
 */

/** All supported element types */
export type ElementType =
  | 'header'
  | 'text'
  | 'image'
  | 'table'
  | 'shape'
  | 'line'
  | 'barcode'
  | 'list';

/** Element role determines visibility across pages */
export type ElementRoleType =
  | 'header'
  | 'content'
  | 'table'
  | 'summary'
  | 'footer'
  | 'watermark';

/** Role configuration */
export interface ElementRole {
  label: string;
  color: string;
  repeatOnAllPages: boolean;
  showOnPages: 'all' | 'first' | 'last';
  paginate?: boolean;
  opacity?: number;
  description: string;
}

/** Base element shared properties */
export interface BaseElement {
  id: string;
  type: ElementType;
  name: string;
  role: ElementRoleType;

  // Position & size (in points)
  x: number;
  y: number;
  w: number;
  h: number;

  // Data binding
  binding?: string;

  /** Conditional visibility (#90): render only when the value at this JSON
   *  path is non-empty. Exported as a FreeMarker guard; empty/unset = always
   *  visible. */
  visibleIf?: string;

  // Z-index order
  zIndex: number;

  // Lock & visibility
  locked: boolean;
  visible: boolean;

  // Grouping — elements with the same groupId move/select together
  groupId?: string;
}

/** Text / Header element */
export interface TextElement extends BaseElement {
  type: 'text' | 'header';
  content: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold';
  color: string;
  textAlign: 'left' | 'center' | 'right';
  fontFamily?: string;
}

/** Image element */
export interface ImageElement extends BaseElement {
  type: 'image';
  src?: string;
  imageData?: string; // base64
  objectFit: 'contain' | 'cover' | 'fill';
}

/** Table column configuration */
export interface TableColumn {
  key: string;
  label: string;
  width: number;
  align: 'left' | 'center' | 'right';
  format: 'text' | 'number' | 'currency' | 'date' | 'percent';
  /** Text overflow mode:
   *  - 'wrap': multi-line word-wrap (respects maxLines if > 0)
   *  - 'ellipsis': single line, truncate with "…"
   *  - 'clip': single line, hard-cut hidden overflow */
  overflow: 'wrap' | 'ellipsis' | 'clip';
  /** Maximum lines when overflow='wrap'. 0 = unlimited. */
  maxLines: number;
  hidden: boolean;
  bold: boolean;
  uppercase: boolean;
  isIndex?: boolean;
  /** Bold the first line of a multi-line cell (item name over memo, #73). */
  boldFirstLine?: boolean;
  /**
   * Two-level header (#104): ADJACENT columns sharing the same non-empty group
   * render one spanning cell above their own labels (e.g. "จำนวนเงิน" over
   * rate + amount). Empty/absent = ungrouped.
   */
  group?: string;
}

/** Table element */
export interface TableElement extends BaseElement {
  type: 'table';
  columns: TableColumn[];
  headerBgColor: string;
  headerTextColor: string;
  borderColor: string;
  alternateRowColor: string;
}

/** Shape element */
export interface ShapeElement extends BaseElement {
  type: 'shape';
  bgColor: string;
  borderRadius: number;
  opacity: number;
}

/** Line element */
export interface LineElement extends BaseElement {
  type: 'line';
  lineColor: string;
  lineWidth: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

/** Barcode element */
export interface BarcodeElement extends BaseElement {
  type: 'barcode';
  value: string;
  barcodeType: 'code128' | 'code39' | 'ean13' | 'qrcode';
}

/** List element */
export interface ListElement extends BaseElement {
  type: 'list';
  items: string[];
  fontSize: number;
  color: string;
  listStyle: 'bullet' | 'number' | 'dash';
}

/** Union type for all elements */
export type CanvasElement =
  | TextElement
  | ImageElement
  | TableElement
  | ShapeElement
  | LineElement
  | BarcodeElement
  | ListElement;

/** Default dimensions per element type */
export const ELEMENT_DEFAULTS: Record<
  ElementType,
  { w: number; h: number; role: ElementRoleType }
> = {
  header:  { w: 400, h: 40,  role: 'header' },
  text:    { w: 200, h: 30,  role: 'content' },
  image:   { w: 150, h: 100, role: 'content' },
  table:   { w: 500, h: 200, role: 'table' },
  shape:   { w: 100, h: 100, role: 'content' },
  line:    { w: 400, h: 10,  role: 'content' },
  barcode: { w: 180, h: 80,  role: 'content' },
  list:    { w: 200, h: 100, role: 'content' },
};
