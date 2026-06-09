const FAVORITE_TICKET_IDS_KEY = "favoriteTicketIds";

function readFavoriteIds() {
  try {
    const raw = localStorage.getItem(FAVORITE_TICKET_IDS_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_) {
    return [];
  }
}

function writeFavoriteIds(ids) {
  localStorage.setItem(FAVORITE_TICKET_IDS_KEY, JSON.stringify(Array.from(new Set(ids.map(String)))));
}

export function getFavoriteTicketIds() {
  return readFavoriteIds();
}

export function isFavoriteTicket(id) {
  if (!id) return false;
  return readFavoriteIds().includes(String(id));
}

export function setFavoriteTicket(id, enabled) {
  if (!id) return [];
  const targetId = String(id);
  const current = readFavoriteIds();
  const next = enabled
    ? [...current, targetId]
    : current.filter((item) => item !== targetId);
  writeFavoriteIds(next);
  window.dispatchEvent(new CustomEvent("ticket-favorites-changed", { detail: { id: targetId, enabled } }));
  return readFavoriteIds();
}
