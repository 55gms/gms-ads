// Image inspection and processing. The real type comes from the file's magic
// bytes; the extension and Content-Type sent by the client are ignored.

import crypto from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

export const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export class ImageError extends Error {
  constructor(message, code = 'invalid_image') {
    super(message);
    this.name = 'ImageError';
    this.status = 400;
    this.code = code;
    this.expose = true;
  }
}

export async function inspectImage(buffer) {
  const type = await fileTypeFromBuffer(buffer);
  if (!type || !IMAGE_TYPES[type.mime]) throw new ImageError('File is not a PNG, JPEG, WebP, GIF, or AVIF image', 'unsupported_type');
  let meta;
  try {
    meta = await sharp(buffer, { animated: true }).metadata();
  } catch {
    throw new ImageError('Image could not be read');
  }
  const pages = meta.pages || 1;
  // For animations sharp reports the full strip height; pageHeight is one frame.
  const height = pages > 1 && meta.pageHeight ? meta.pageHeight : meta.height;
  return { mime: type.mime, ext: IMAGE_TYPES[type.mime], width: meta.width, height, animated: pages > 1 };
}

function encode(pipeline, mime) {
  if (mime === 'image/png') return pipeline.png({ compressionLevel: 9 });
  if (mime === 'image/jpeg') return pipeline.jpeg({ quality: 88, mozjpeg: true });
  if (mime === 'image/webp') return pipeline.webp({ quality: 88 });
  if (mime === 'image/gif') return pipeline.gif();
  return pipeline.avif({ quality: 60 });
}

// Validates an upload against the target size, optionally resizes it, strips
// metadata by re-encoding, and builds a WebP variant for static images.
export async function processUpload(buffer, { width, height, resize = false, maxBytes }) {
  if (buffer.length > maxBytes) throw new ImageError('File is larger than 2 MB', 'too_large');
  const info = await inspectImage(buffer);
  const matches = info.width === width && info.height === height;
  if (!matches && !resize) {
    throw new ImageError(
      `Image is ${info.width}×${info.height} but the selected size is ${width}×${height}. Tick "Resize to fit" or pick the matching size.`,
      'dimension_mismatch'
    );
  }
  // Re-encoding drops EXIF, ICC, and XMP because sharp does not copy metadata.
  let pipeline = sharp(buffer, { animated: info.animated }).rotate();
  if (!matches) pipeline = pipeline.resize(width, height, { fit: 'cover', position: 'centre' });
  const output = await encode(pipeline, info.mime).toBuffer();
  if (output.length > maxBytes) throw new ImageError('Processed image is larger than 2 MB', 'too_large');

  let webp = null;
  if (!info.animated && info.mime !== 'image/webp') {
    const candidate = await sharp(output).webp({ quality: 82 }).toBuffer();
    // Keep the variant only when it actually saves bytes.
    if (candidate.length < output.length) webp = candidate;
  }
  return {
    buffer: output,
    webp,
    sha256: crypto.createHash('sha256').update(output).digest('hex'),
    mime: info.mime,
    ext: info.ext,
    width,
    height,
    resized: !matches,
  };
}
