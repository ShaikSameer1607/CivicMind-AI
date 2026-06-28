/** Lightweight toast notification system — no external dependencies */

let toastContainer = null;

function ensureContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

/**
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {string} message
 * @param {number} [durationMs]
 */
export function showToast(type, message, durationMs = 4500) {
  const container = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${{ success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => {
    el.classList.remove('toast-visible');
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

export function showError(message) {
  showToast('error', message);
}

export function showSuccess(message) {
  showToast('success', message);
}

export function showWarning(message) {
  showToast('warning', message);
}

export function showInfo(message) {
  showToast('info', message);
}

/** Map Firebase/Gemini/network errors to friendly messages */
export function friendlyError(err) {
  const msg = err?.message || String(err);
  if (/index|indexes/i.test(msg) && /firestore|firebase/i.test(msg)) {
    return 'A Firestore index is required. See DEPLOYMENT.md for index setup, or create the index from the Firebase Console link in the browser console.';
  }
  if (/permission|insufficient/i.test(msg)) {
    return 'Access denied. Check Firestore rules or sign in again.';
  }
  if (/network|fetch|offline/i.test(msg)) {
    return 'Network error. Check your connection and try again.';
  }
  if (/storage|upload/i.test(msg)) {
    return `Upload failed: ${msg}`;
  }
  if (/gemini|api key|generative/i.test(msg)) {
    return 'AI service unavailable. Heuristic fallback will be used.';
  }
  return msg;
}

export function isFirestoreIndexError(err) {
  const msg = err?.message || String(err);
  return /index|indexes/i.test(msg);
}

export function handleAppError(err, fallbackMessage = 'Something went wrong') {
  const message = friendlyError(err) || fallbackMessage;
  console.error('[CivicMind]', err);
  showError(message);
  return message;
}
