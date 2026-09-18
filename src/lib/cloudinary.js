// Subida de imágenes a Cloudinary con preset UNSIGNED (sin firmar).
// Requiere en .env.local (valores los pone el dueño del proyecto):
//   NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
//   NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET=
//   NEXT_PUBLIC_CLOUDINARY_FOLDER=      (opcional)
//
// Cómo obtenerlos: Cloudinary Console → Settings → Upload → crear un
// "Upload preset" en modo "Unsigned" y copiar su nombre + el Cloud name.

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "";
const UPLOAD_PRESET = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "";
const FOLDER = process.env.NEXT_PUBLIC_CLOUDINARY_FOLDER || "";

export function isCloudinaryConfigured() {
  return Boolean(CLOUD_NAME && UPLOAD_PRESET);
}

export function cloudinaryStatus() {
  if (CLOUD_NAME && UPLOAD_PRESET) return "ready";
  if (!CLOUD_NAME && !UPLOAD_PRESET) return "missing";
  return "incomplete";
}

/**
 * Sube un archivo a Cloudinary (unsigned) y devuelve { url, publicId, provider }.
 * @param {File} file - imagen (máx 10 MB)
 * @param {string} folder - subcarpeta; si se omite usa NEXT_PUBLIC_CLOUDINARY_FOLDER
 */
export async function uploadImageToCloudinary(file, folder) {
  if (!file) throw new Error("Sin archivo para subir.");
  if (!isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary no configurado. Llena NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME y NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET en .env.local."
    );
  }
  if (!file.type.startsWith("image/")) {
    throw new Error("El archivo debe ser una imagen.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("La imagen no puede superar 10 MB.");
  }

  const targetFolder = folder || FOLDER || undefined;
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", UPLOAD_PRESET);
  if (targetFolder) form.append("folder", targetFolder);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
    { method: "POST", body: form }
  );
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data?.error?.message || JSON.stringify(data);
    } catch {
      detail = await res.text();
    }
    throw new Error(`Cloudinary: ${detail || `HTTP ${res.status}`}`);
  }
  const data = await res.json();
  return {
    url: data.secure_url,
    publicId: data.public_id,
    provider: "cloudinary",
  };
}

// Nota: con upload UNSIGNED no se puede borrar desde el cliente (requiere
// API secret en servidor). Por eso guardamos storagePath vacío cuando la
// imagen viene de Cloudinary y el borrado se vuelve no-op.
export function isCloudinaryUrl(url) {
  return typeof url === "string" && url.includes("res.cloudinary.com");
}
