let identityEpoch = 0;
let identityChanging = false;
const pendingRequests = new Set<AbortController>();
const pendingUploads = new Set<XMLHttpRequest>();

export function invalidateIdentityRequests(changing = false) {
  identityEpoch++;
  identityChanging = changing;
  for (const request of pendingRequests) request.abort();
  for (const upload of pendingUploads) upload.abort();
  pendingRequests.clear(); pendingUploads.clear();
}
export function currentIdentityEpoch() { return identityEpoch; }
export function identityTransitionInProgress() { return identityChanging; }
export function trackIdentityRequest(controller: AbortController) { pendingRequests.add(controller); return () => { pendingRequests.delete(controller); }; }
export function trackIdentityUpload(request: XMLHttpRequest) { pendingUploads.add(request); return () => { pendingUploads.delete(request); }; }
export function csrfHeader() {
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('cpms_csrf='))?.slice('cpms_csrf='.length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : '';
}
export function signalSessionExpired() { window.dispatchEvent(new Event('cpms:session-expired')); }
