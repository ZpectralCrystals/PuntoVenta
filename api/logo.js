import { authenticate, bodyOf, sendJson } from '../server/cloud-store.mjs';

const mimeExtensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });
  try {
    const auth = await authenticate(req);
    if (!auth || auth.user.role !== 'admin') return sendJson(res, 403, { error: 'Solo administrador' });
    const dataUrl = String(bodyOf(req).dataUrl || '');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return sendJson(res, 400, { error: 'Formato de imagen inválido' });
    const [, contentType, encoded] = match;
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length || bytes.length > 1024 * 1024) return sendJson(res, 400, { error: 'Logo debe pesar máximo 1 MB' });

    const path = `receipt/logo.${mimeExtensions[contentType]}`;
    const { error } = await auth.db.storage.from('pos-assets').upload(path, bytes, {
      contentType,
      cacheControl: '3600',
      upsert: true,
    });
    if (error) throw error;
    const { data } = auth.db.storage.from('pos-assets').getPublicUrl(path);
    return sendJson(res, 200, { url: `${data.publicUrl}?v=${Date.now()}` });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'No se pudo subir logo' });
  }
}
