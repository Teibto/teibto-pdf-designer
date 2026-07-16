/**
 * Image Upload Service
 * Handles image upload, paste, and drag-drop for Image elements.
 * Resizes images to stay within reasonable file size limits.
 *
 * @author Wichit Wongta
 */
import type { AppStore } from '../state/store';
import { updateElement } from '../state/actions';

/** Maximum image dimension (width or height) in pixels */
const MAX_DIMENSION = 1200;

/** Maximum base64 data URL length (~1.5MB) */
const MAX_DATA_LENGTH = 2_000_000;

/** Accepted image MIME types */
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

/**
 * Read a File as a base64 data URL.
 */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Resize an image data URL to fit within MAX_DIMENSION,
 * maintaining aspect ratio. Returns a new data URL.
 */
function resizeImage(dataUrl: string, maxDim = MAX_DIMENSION): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // No resize needed if within limits
      if (width <= maxDim && height <= maxDim && dataUrl.length <= MAX_DATA_LENGTH) {
        resolve(dataUrl);
        return;
      }

      // Calculate new dimensions
      if (width > height) {
        if (width > maxDim) {
          height = Math.round(height * (maxDim / width));
          width = maxDim;
        }
      } else {
        if (height > maxDim) {
          width = Math.round(width * (maxDim / height));
          height = maxDim;
        }
      }

      // Draw to canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Cannot get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Try JPEG first (smaller), fallback to PNG
      let result = canvas.toDataURL('image/jpeg', 0.85);
      if (result.length > MAX_DATA_LENGTH) {
        result = canvas.toDataURL('image/jpeg', 0.6);
      }
      if (result.length > MAX_DATA_LENGTH) {
        result = canvas.toDataURL('image/jpeg', 0.4);
      }

      resolve(result);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Process and upload an image to an element.
 * Reads the file, resizes if needed, and updates the element's imageData.
 */
export async function uploadImageToElement(
  store: AppStore,
  elementId: string,
  file: File,
): Promise<void> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new Error(`Unsupported image type: ${file.type}`);
  }

  const dataUrl = await readFileAsDataURL(file);
  const resized = await resizeImage(dataUrl);

  updateElement(store, elementId, 'imageData' as any, resized);
}

/**
 * Process an image from a paste event on the canvas.
 * If an image element is selected, applies the image to it.
 * Returns true if an image was processed.
 */
export async function handlePasteImage(
  store: AppStore,
  event: ClipboardEvent,
): Promise<boolean> {
  const items = event.clipboardData?.items;
  if (!items) return false;

  for (const item of Array.from(items)) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (!file) continue;

      const { selectedId, elements } = store.state;
      if (!selectedId) return false;

      const el = elements.find((e) => e.id === selectedId);
      if (!el || el.type !== 'image') return false;

      await uploadImageToElement(store, selectedId, file);
      return true;
    }
  }

  return false;
}

/**
 * Handle drag-drop of an image file onto a canvas element.
 */
export async function handleDropImage(
  store: AppStore,
  elementId: string,
  event: DragEvent,
): Promise<boolean> {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return false;

  const file = files[0];
  if (!file.type.startsWith('image/')) return false;

  const el = store.state.elements.find((e) => e.id === elementId);
  if (!el || el.type !== 'image') return false;

  await uploadImageToElement(store, elementId, file);
  return true;
}

/**
 * Open a file picker dialog and upload to the specified image element.
 */
export function openImagePicker(store: AppStore, elementId: string): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
  input.style.display = 'none';

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      await uploadImageToElement(store, elementId, file);
    } catch (err) {
      console.error('Image upload failed:', err);
    }

    input.remove();
  });

  document.body.appendChild(input);
  input.click();
}

/**
 * Clear the image from an image element.
 */
export function clearElementImage(store: AppStore, elementId: string): void {
  updateElement(store, elementId, 'imageData' as any, undefined);
  updateElement(store, elementId, 'src' as any, undefined);
}
