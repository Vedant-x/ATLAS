// HTML-escape text before it goes into markup (text or an attribute value): & < > " ' as numeric
// entities; null and undefined as nothing. The one copy every view imports.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
