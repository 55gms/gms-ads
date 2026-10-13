// Minimal tus 1.0 client for Bunny Stream: create, PATCH in chunks with
// progress, HEAD to find the offset after a failure, bounded retries. The
// signed headers come from our server; the Bunny API key never reaches here.

const CHUNK = 8 * 1024 * 1024;
const RETRIES = 4;

const b64 = (s) => btoa(unescape(encodeURIComponent(s)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function xhr(method, url, { headers = {}, body, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest();
    req.open(method, url);
    for (const [k, v] of Object.entries(headers)) req.setRequestHeader(k, v);
    if (onProgress) req.upload.onprogress = (e) => onProgress(e.loaded);
    req.onload = () => resolve(req);
    req.onerror = () => reject(new Error('Network error during upload'));
    req.ontimeout = () => reject(new Error('Upload timed out'));
    if (signal) {
      if (signal.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
      signal.addEventListener('abort', () => {
        req.abort();
        reject(new DOMException('Upload cancelled', 'AbortError'));
      });
    }
    req.send(body ?? null);
  });
}

// ticket: { endpoint, headers, metadata } from POST /api/admin/videos.
// Returns once Bunny has every byte. `state.url` lets a caller resume.
export async function tusUpload(file, ticket, { onProgress, signal, state = {} } = {}) {
  const auth = { 'Tus-Resumable': '1.0.0', ...ticket.headers };
  if (!state.url) {
    const metadata = Object.entries({ filetype: file.type, title: file.name, ...ticket.metadata })
      .map(([k, v]) => `${k} ${b64(String(v))}`)
      .join(',');
    const res = await xhr('POST', ticket.endpoint, { headers: { ...auth, 'Upload-Length': String(file.size), 'Upload-Metadata': metadata }, signal });
    if (res.status !== 201) throw new Error(res.status === 401 ? 'Upload authorization expired. Retry the upload.' : `Upload could not start (${res.status})`);
    const location = res.getResponseHeader('Location');
    if (!location) throw new Error('Upload server did not return an upload address');
    state.url = new URL(location, ticket.endpoint).toString();
  }

  let offset = 0;
  let failures = 0;
  const findOffset = async () => {
    const res = await xhr('HEAD', state.url, { headers: auth, signal });
    if (res.status === 404 || res.status === 410) throw new Error('The upload expired on the server. Start it again.');
    return Number(res.getResponseHeader('Upload-Offset')) || 0;
  };
  if (state.resumed) offset = await findOffset();

  while (offset < file.size) {
    const end = Math.min(file.size, offset + CHUNK);
    try {
      const res = await xhr('PATCH', state.url, {
        headers: { ...auth, 'Content-Type': 'application/offset+octet-stream', 'Upload-Offset': String(offset) },
        body: file.slice(offset, end),
        signal,
        onProgress: (loaded) => onProgress?.((offset + loaded) / file.size),
      });
      if (res.status !== 204) throw new Error(`Upload chunk rejected (${res.status})`);
      offset = Number(res.getResponseHeader('Upload-Offset')) || end;
      failures = 0;
      onProgress?.(offset / file.size);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      failures += 1;
      if (failures > RETRIES) throw err;
      await sleep(1000 * 2 ** failures);
      offset = await findOffset();
    }
  }
  state.resumed = true;
}
