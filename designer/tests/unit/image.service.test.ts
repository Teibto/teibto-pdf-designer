/**
 * Tests: image.service.ts embedded-image upload policy.
 * @author Wichit Wongta
 * @since 2026-09-12
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppStore } from '../../src/state/store';
import type { ImageElement } from '../../src/models/element';
import { openImagePicker, uploadImageToElement } from '../../src/services/image.service';

const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const VALID_JPEG_PAYLOAD = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==';

function createStoreWithImage(): AppStore {
  const store = new AppStore();
  store.dispatch((draft) => {
    draft.elements.push({
      id: 'img-1', type: 'image', name: 'Image', role: 'content',
      x: 0, y: 0, w: 100, h: 50, zIndex: 0, locked: false, visible: true,
      src: '', objectFit: 'contain',
    } as ImageElement);
  });
  return store;
}

function stubSuccessfulRead(dataUrl: string): void {
  class MockFileReader {
    result: string | null = null;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;

    readAsDataURL(): void {
      this.result = dataUrl;
      this.onload?.();
    }
  }

  class MockImage {
    width = 1;
    height = 1;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;

    set src(_value: string) {
      this.onload?.();
    }
  }

  vi.stubGlobal('FileReader', MockFileReader);
  vi.stubGlobal('Image', MockImage);
}

afterEach(() => vi.unstubAllGlobals());

describe('embedded image upload policy', () => {
  it.each(['image/gif', 'image/webp', 'image/svg+xml'])(
    'rejects unsupported uploader MIME %s with an actionable message',
    async (type) => {
      await expect(uploadImageToElement(createStoreWithImage(), 'img-1', { type } as File))
        .rejects.toThrow(/รองรับเฉพาะไฟล์ PNG หรือ JPEG.*Only PNG and JPEG/);
    },
  );

  it.each([
    ['image/png', VALID_PNG],
    ['image/jpeg', `data:image/jpeg;base64,${VALID_JPEG_PAYLOAD}`],
    ['image/jpg', `data:image/jpg;base64,${VALID_JPEG_PAYLOAD}`],
  ])('accepts %s and stores validated embedded data', async (type, dataUrl) => {
    stubSuccessfulRead(dataUrl);
    const store = createStoreWithImage();

    await uploadImageToElement(store, 'img-1', { type } as File);

    expect((store.state.elements[0] as ImageElement).imageData).toBe(dataUrl);
  });

  it('rejects malformed data returned by an allowed PNG upload', async () => {
    stubSuccessfulRead('data:image/png;base64,not_base64!');

    await expect(uploadImageToElement(
      createStoreWithImage(),
      'img-1',
      { type: 'image/png' } as File,
    )).rejects.toThrow(/Invalid or unsupported embedded image/);
  });

  it('rejects a File MIME that disagrees with the decoded data URL MIME', async () => {
    stubSuccessfulRead(VALID_PNG);

    await expect(uploadImageToElement(
      createStoreWithImage(),
      'img-1',
      { type: 'image/jpeg' } as File,
    )).rejects.toThrow(/Only PNG and JPEG image uploads are supported/);
  });

  it('limits the file picker to PNG/JPEG formats', () => {
    const input = {
      type: '', accept: '', style: { display: '' }, files: undefined,
      addEventListener: vi.fn(), remove: vi.fn(), click: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => input),
      body: { appendChild: vi.fn() },
    });

    openImagePicker(createStoreWithImage(), 'img-1');

    expect(input.accept).toBe('image/png,image/jpeg,image/jpg,.png,.jpg,.jpeg');
    expect(input.accept).not.toMatch(/gif|webp|svg/);
  });

  it('keeps the newest overlapping upload when reads resolve out of order', async () => {
    const readers: Array<{ resolve(dataUrl: string): void }> = [];
    class DeferredFileReader {
      result: string | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL(): void {
        readers.push({ resolve: (dataUrl) => { this.result = dataUrl; this.onload?.(); } });
      }
    }
    class ImmediateImage {
      width = 1; height = 1;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { this.onload?.(); }
    }
    vi.stubGlobal('FileReader', DeferredFileReader);
    vi.stubGlobal('Image', ImmediateImage);
    const store = createStoreWithImage();

    const older = uploadImageToElement(store, 'img-1', { type: 'image/png' } as File);
    const newer = uploadImageToElement(store, 'img-1', { type: 'image/jpeg' } as File);
    readers[1].resolve(`data:image/jpeg;base64,${VALID_JPEG_PAYLOAD}`);
    await newer;
    readers[0].resolve(VALID_PNG);
    await older;

    expect((store.state.elements[0] as ImageElement).imageData)
      .toBe(`data:image/jpeg;base64,${VALID_JPEG_PAYLOAD}`);
  });

  it('discards an upload completion after a document-session replacement reuses the id', async () => {
    let resolveRead!: (dataUrl: string) => void;
    class DeferredFileReader {
      result: string | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL(): void {
        resolveRead = (dataUrl) => { this.result = dataUrl; this.onload?.(); };
      }
    }
    vi.stubGlobal('FileReader', DeferredFileReader);
    const store = createStoreWithImage();
    const pending = uploadImageToElement(store, 'img-1', { type: 'image/png' } as File);

    store.beginDocumentSession();
    store.dispatch((draft) => {
      draft.elements = [{
        id: 'img-1', type: 'image', name: 'Replacement', role: 'content',
        x: 0, y: 0, w: 100, h: 50, zIndex: 0, locked: false, visible: true,
        src: '', objectFit: 'contain',
      } as ImageElement];
    });
    resolveRead(VALID_PNG);
    await pending;

    expect((store.state.elements[0] as ImageElement).imageData).toBeUndefined();
    expect(store.state.elements[0].name).toBe('Replacement');
  });
});
