// Log error categories, never raw exception messages, request payloads or credentials.
function logError(context, error) {
  const safe = value => /^[a-zA-Z0-9_.-]{1,80}$/.test(String(value || '')) ? String(value) : 'UNKNOWN';
  console.error(context, { name: safe(error?.name), code: safe(error?.code) });
}
module.exports = { logError };
