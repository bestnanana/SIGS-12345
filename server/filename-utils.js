function hasMojibakeMarkers(value) {
  return /[\u0080-\u009FÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/.test(value);
}

function decodeLatin1Mojibake(value) {
  return Buffer.from(value, "latin1").toString("utf8");
}

function normalizeOriginalFilename(filename) {
  const value = String(filename || "attachment");
  if (!hasMojibakeMarkers(value)) return value;

  const decoded = decodeLatin1Mojibake(value);
  if (decoded && !decoded.includes("\uFFFD")) return decoded;
  return value;
}

function contentDispositionFilename(filename) {
  const normalized = normalizeOriginalFilename(filename);
  const fallback = normalized
    .replace(/["\\\r\n]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .slice(0, 180) || "attachment";
  const encoded = encodeURIComponent(normalized).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

module.exports = {
  contentDispositionFilename,
  normalizeOriginalFilename
};
