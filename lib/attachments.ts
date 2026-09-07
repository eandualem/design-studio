import type { Attachment, AttachmentPreview } from "@/types";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function readImageFile(file: File): Promise<AttachmentPreview> {
  return new Promise((resolve, reject) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      reject(new Error(`${file.name}: only PNG, JPEG, WebP or GIF images`));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error(`${file.name}: larger than 6 MB`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, dataUri: String(reader.result) });
    reader.onerror = () => reject(reader.error ?? new Error(`${file.name}: could not be read`));
    reader.readAsDataURL(file);
  });
}

/** Dropped images travel as reference attachments the model sees directly. */
export function toReferenceAttachments(previews: AttachmentPreview[]): Attachment[] {
  return previews.map((p) => ({
    kind: "image",
    purpose: "reference",
    name: p.name,
    data_uri: p.dataUri,
  }));
}
