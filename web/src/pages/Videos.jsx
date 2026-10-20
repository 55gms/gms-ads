import { CircleAlert, CircleCheck, Clapperboard, Ellipsis, Film, Link2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import { api, del, errorMessage, fieldErrors, get, invalidate, patch, post } from '../lib/api.js';
import { cx } from '../lib/cx.js';
import { bytes } from '../lib/format.js';
import { useCanWrite } from '../lib/session.js';
import { toast } from '../lib/stores.js';
import { tusUpload } from '../lib/tus.js';
import { Badge } from '../ui/Badge.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { Checkbox } from '../ui/Controls.jsx';
import { Field, Input, Select } from '../ui/Field.jsx';
import { Menu } from '../ui/Floating.jsx';
import { EmptyState, PageHeader } from '../ui/Misc.jsx';
import { ConfirmModal, Modal } from '../ui/Overlay.jsx';
import { Segmented } from '../ui/Tabs.jsx';

const PLACEMENTS = [
  { value: 'video_embedded', label: 'Embedded', hint: 'Plays in a page slot after a click' },
  { value: 'video_fullscreen', label: 'Full screen', hint: 'At a natural break, started by the player' },
  { value: 'video_rewarded', label: 'Rewarded', hint: 'Watched by choice for an in-game reward' },
];
const ALL_PLACEMENTS = PLACEMENTS.map((p) => p.value);
const placementLabel = (value) => PLACEMENTS.find((p) => p.value === value)?.label || value;

const STATUS = {
  uploading: { tone: 'blue', label: 'Uploading' },
  uploaded: { tone: 'blue', label: 'Uploaded' },
  processing: { tone: 'amber', label: 'Processing' },
  ready: { tone: 'green', label: 'Ready' },
  failed: { tone: 'red', label: 'Failed' },
  archived: { tone: 'gray', label: 'Archived' },
};

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'processing', label: 'Processing' },
  { value: 'ready', label: 'Ready' },
  { value: 'failed', label: 'Failed' },
  { value: 'archived', label: 'Archived' },
];

const duration = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '—');

export async function videosLoader({ request }) {
  const status = new URL(request.url).searchParams.get('status') || '';
  const [videos, campaigns] = await Promise.all([get(api('/videos'), { status: status || undefined }), get(api('/campaigns'))]);
  return { ...videos, campaigns: campaigns.campaigns, status };
}

// Images | Videos switch shared by both library pages.
export function LibraryTabs({ active }) {
  return (
    <nav aria-label="Creative type" className="mb-6 inline-flex rounded-sm bg-gray-100 p-0.5">
      {[
        { to: '/creatives', label: 'Images', key: 'images' },
        { to: '/creatives/videos', label: 'Videos', key: 'videos' },
      ].map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          aria-current={active === tab.key ? 'page' : undefined}
          className={cx('inline-flex h-8 items-center rounded-[4px] px-3 copy-13 font-medium ease-hover', active === tab.key ? 'border border-gray-400 bg-background-100 text-gray-1000' : 'text-gray-900 hover:text-gray-1000')}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

function PlacementPicker({ value, onChange, error }) {
  const toggle = (p) => onChange(value.includes(p) ? value.filter((x) => x !== p) : [...value, p]);
  return (
    <fieldset>
      <legend className="copy-13 font-medium text-gray-900">Placements</legend>
      <div className="mt-2 flex flex-col gap-1">
        {PLACEMENTS.map((p) => (
          <Checkbox key={p.value} checked={value.includes(p.value)} onChange={() => toggle(p.value)}>
            <span>
              {p.label} <span className="copy-13 text-gray-900">· {p.hint}</span>
            </span>
          </Checkbox>
        ))}
      </div>
      {error && <p role="alert" className="mt-1 copy-13 text-red-text">{error}</p>}
    </fieldset>
  );
}

function CampaignSelect({ campaigns, ...props }) {
  return (
    <Select {...props}>
      <option value="">No campaign yet</option>
      {campaigns.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

// Upload: create the video (server signs a TUS ticket), send the file
// straight to Bunny, then tell the server it arrived.
function UploadModal({ open, onClose, campaigns, limits, onDone }) {
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ title: '', campaignId: '', placements: ALL_PLACEMENTS });
  const [errors, setErrors] = useState({});
  const [phase, setPhase] = useState('idle'); // idle | uploading | finishing | error
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const resumeRef = useRef(null);
  // Mirrors resumeRef for rendering: an interrupted upload can be resumed.
  const [resumable, setResumable] = useState(false);

  const reset = () => {
    setFile(null);
    setForm({ title: '', campaignId: '', placements: ALL_PLACEMENTS });
    setErrors({});
    setPhase('idle');
    setProgress(0);
    resumeRef.current = null;
    setResumable(false);
  };
  const close = () => {
    if (phase === 'uploading') abortRef.current?.abort();
    reset();
    onClose();
  };

  const pick = (f) => {
    if (!f) return;
    const next = {};
    if (!f.type.startsWith('video/')) next.file = 'Choose a video file';
    else if (f.size > limits.maxUploadBytes) next.file = `Videos can be at most ${bytes(limits.maxUploadBytes)}`;
    setErrors(next);
    setFile(f);
    if (!form.title) setForm((prev) => ({ ...prev, title: f.name.replace(/\.[^.]+$/, '').slice(0, 120) }));
  };

  const send = async (video, ticket) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('uploading');
    const state = resumeRef.current?.state || {};
    resumeRef.current = { video, ticket, state };
    setResumable(true);
    await tusUpload(file, ticket, { onProgress: setProgress, signal: controller.signal, state });
    setPhase('finishing');
    await post(api(`/videos/${video.id}/uploaded`));
  };

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    if (!file) next.file = 'Choose a video file';
    if (!form.title.trim()) next.title = 'Give the video a title';
    if (!form.placements.length) next.placements = 'Pick at least one placement';
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      let video;
      let ticket;
      if (resumeRef.current) {
        // Resume the same Bunny video with a fresh signature.
        video = resumeRef.current.video;
        ticket = { ...(await post(api(`/videos/${video.id}/upload-ticket`))).upload, metadata: resumeRef.current.ticket.metadata };
        resumeRef.current.state.resumed = true;
      } else {
        const created = await post(api('/videos'), { title: form.title.trim(), campaignId: form.campaignId || null, placements: form.placements, fileSize: file.size, fileType: file.type });
        video = created.video;
        ticket = created.upload;
      }
      await send(video, ticket);
      toast.success('Uploaded. Bunny is processing the video.');
      reset();
      onDone();
      onClose();
    } catch (error) {
      if (error.name === 'AbortError') return;
      setPhase('error');
      setMessage(errorMessage(error, error.message || 'Upload failed'));
      setErrors(fieldErrors(error));
    }
  };

  const busy = phase === 'uploading' || phase === 'finishing';
  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload video"
      description={`MP4, WebM, or MOV up to ${bytes(limits.maxUploadBytes)} and ${limits.maxDurationSeconds} seconds. The file goes straight to Bunny Stream.`}
      width="max-w-lg"
      footer={
        <>
          <Button onClick={close}>{busy ? 'Cancel upload' : 'Cancel'}</Button>
          <Button variant="primary" type="submit" form="video-upload" loading={busy} disabled={Boolean(errors.file)}>
            {phase === 'error' && resumable ? 'Resume upload' : 'Upload'}
          </Button>
        </>
      }
    >
      <form id="video-upload" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div>
          <Button type="button" icon={Film} onClick={() => inputRef.current?.click()} disabled={busy}>
            {file ? 'Choose another file' : 'Choose video'}
          </Button>
          <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime,video/x-matroska" className="sr-only" tabIndex={-1} aria-label="Choose a video" onChange={(e) => pick(e.target.files[0])} />
          {file && (
            <p className="mt-2 font-mono copy-12 text-gray-900">
              {file.name} · {bytes(file.size)}
            </p>
          )}
          {errors.file && <p role="alert" className="mt-1 copy-13 text-red-text">{errors.file}</p>}
        </div>
        <Field label="Title" error={errors.title}>
          {(props) => <Input {...props} maxLength={120} value={form.title} disabled={busy || resumable} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
        </Field>
        <Field label="Campaign" optional hint="You can also attach it from the campaign editor later.">
          {(props) => <CampaignSelect {...props} campaigns={campaigns} value={form.campaignId} disabled={busy || resumable} onChange={(e) => setForm({ ...form, campaignId: e.target.value })} />}
        </Field>
        <PlacementPicker value={form.placements} onChange={(placements) => setForm({ ...form, placements })} error={errors.placements} />
        {phase !== 'idle' && (
          <div>
            <div role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} className="h-1.5 overflow-hidden rounded-full bg-gray-300">
              <div style={{ transform: `scaleX(${progress})` }} className="h-full origin-left bg-blue transition-transform duration-[120ms] ease-standard" />
            </div>
            <p className={cx('mt-2 copy-13', phase === 'error' ? 'text-red-text' : 'text-gray-900')} role={phase === 'error' ? 'alert' : undefined}>
              {phase === 'uploading' && `Uploading… ${Math.round(progress * 100)}%`}
              {phase === 'finishing' && 'Confirming with Bunny…'}
              {phase === 'error' && message}
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}

function ExternalVideoModal({ open, onClose, campaigns, hosts, maxDuration, onDone }) {
  const empty = { title: '', url: '', posterUrl: '', durationSeconds: '', campaignId: '', placements: ALL_PLACEMENTS };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    if (!form.title.trim()) next.title = 'Give the video a title';
    if (!/^https:\/\/\S+\.(mp4|webm)(\?\S*)?$/i.test(form.url.trim())) next.url = 'Enter an https:// link to an .mp4 or .webm file';
    const d = Number(form.durationSeconds);
    if (!(d >= 1 && d <= maxDuration)) next.durationSeconds = `Enter the length, 1 to ${maxDuration} seconds`;
    if (!form.placements.length) next.placements = 'Pick at least one placement';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await post(api('/videos/external'), { ...form, url: form.url.trim(), posterUrl: form.posterUrl.trim() || null, durationSeconds: d, campaignId: form.campaignId || null });
      toast.success('Added video');
      setForm(empty);
      onDone();
      onClose();
    } catch (error) {
      setErrors({ url: errorMessage(error), ...fieldErrors(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add video by URL"
      description={`A progressive file on an allowed host (${hosts.join(', ') || 'any public https host'}). It is played from there, not copied.`}
      width="max-w-lg"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="video-external" loading={saving}>
            Add video
          </Button>
        </>
      }
    >
      <form id="video-external" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Title" error={errors.title}>
          {(props) => <Input {...props} data-autofocus maxLength={120} value={form.title} onChange={set('title')} />}
        </Field>
        <Field label="Video URL" error={errors.url}>
          {(props) => <Input {...props} type="url" mono placeholder="https://cdn.jsdelivr.net/gh/org/repo@v1/ad.mp4" value={form.url} onChange={set('url')} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Length" error={errors.durationSeconds} hint="Rewards are checked against it.">
            {(props) => <Input {...props} inputMode="decimal" suffix="sec" value={form.durationSeconds} onChange={set('durationSeconds')} />}
          </Field>
          <Field label="Campaign" optional>
            {(props) => <CampaignSelect {...props} campaigns={campaigns} value={form.campaignId} onChange={set('campaignId')} />}
          </Field>
        </div>
        <Field label="Poster image URL" optional error={errors.posterUrl}>
          {(props) => <Input {...props} type="url" mono value={form.posterUrl} onChange={set('posterUrl')} />}
        </Field>
        <PlacementPicker value={form.placements} onChange={(placements) => setForm({ ...form, placements })} error={errors.placements} />
      </form>
    </Modal>
  );
}

function EditModal({ video, campaigns, onClose, onDone }) {
  const [form, setForm] = useState(() => ({ title: video?.title || '', campaignId: video?.campaign_id || '', placements: video?.placements || ALL_PLACEMENTS }));
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const submit = async (event) => {
    event.preventDefault();
    if (!form.placements.length) return setErrors({ placements: 'Pick at least one placement' });
    setSaving(true);
    try {
      await patch(api(`/videos/${video.id}`), { title: form.title.trim(), campaignId: form.campaignId || null, placements: form.placements });
      toast.success('Saved video');
      onDone();
      onClose();
    } catch (error) {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={Boolean(video)}
      onClose={onClose}
      title="Edit video"
      width="max-w-lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="video-edit" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="video-edit" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Title" error={errors.title}>
          {(props) => <Input {...props} maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}
        </Field>
        <Field label="Campaign" optional>
          {(props) => <CampaignSelect {...props} campaigns={campaigns} value={form.campaignId} onChange={(e) => setForm({ ...form, campaignId: e.target.value })} />}
        </Field>
        <PlacementPicker value={form.placements} onChange={(placements) => setForm({ ...form, placements })} error={errors.placements} />
      </form>
    </Modal>
  );
}

// Preview with the real delivery URLs. HLS-only videos load hls.js on demand
// in browsers without native HLS.
function VideoPreview({ video, onClose }) {
  const ref = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const el = ref.current;
    const src = video?.preview;
    if (!el || !src) return undefined;
    let hls;
    let cancelled = false;
    if (src.mp4) el.src = src.mp4;
    else if (src.hls && el.canPlayType('application/vnd.apple.mpegurl')) el.src = src.hls;
    else if (src.hls) {
      import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) return setError('This browser cannot play HLS.');
          hls = new Hls();
          hls.loadSource(src.hls);
          hls.attachMedia(el);
        })
        .catch(() => setError('The HLS player failed to load.'));
    }
    return () => {
      cancelled = true;
      hls?.destroy();
      el.removeAttribute('src');
      el.load();
    };
  }, [video]);
  return (
    <Modal open={Boolean(video)} onClose={onClose} title={video?.title || 'Preview'} width="max-w-[880px]" footer={<Button onClick={onClose}>Close</Button>}>
      {video && (
        <>
          <video ref={ref} controls playsInline preload="metadata" poster={video.preview?.poster || undefined} className="aspect-video w-full rounded-md bg-gray-1000" onError={() => setError('The video could not be played from its delivery URL.')} />
          {error && <p role="alert" className="mt-2 copy-13 text-red-text">{error}</p>}
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 copy-13 md:grid-cols-4">
            {[
              ['Length', duration(video.duration_seconds)],
              ['Resolution', video.width && video.height ? `${video.width}×${video.height}` : '—'],
              ['Renditions', video.available_resolutions || (video.provider === 'external' ? 'Original' : '—')],
              ['Campaign', video.campaign_name || 'Unassigned'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-gray-900">{label}</dt>
                <dd className={label === 'Campaign' ? '' : 'font-mono'}>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Modal>
  );
}

function VideoCard({ video, canWrite, onPreview, onEdit, onSync, onArchive, onUnarchive, onDelete }) {
  const meta = STATUS[video.status] || STATUS.processing;
  const moving = ['uploading', 'uploaded', 'processing'].includes(video.status);
  return (
    <li className="group overflow-hidden rounded-md border border-gray-400 ease-hover hover:border-gray-500">
      <button type="button" disabled={video.status !== 'ready'} onClick={onPreview} aria-label={`Preview ${video.title}`} className="relative grid aspect-video w-full place-items-center bg-gray-1000 enabled:cursor-pointer">
        {video.preview?.poster ? <img src={video.preview.poster} alt="" loading="lazy" className="h-full w-full object-cover" /> : <Clapperboard size={28} strokeWidth={1.25} aria-hidden="true" className="text-gray-700" />}
        {video.status === 'ready' && <span className="absolute right-2 bottom-2 rounded-sm bg-black/70 px-1.5 font-mono copy-12 text-white">{duration(video.duration_seconds)}</span>}
        {moving && video.provider === 'bunny' && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
            <span className="block h-full origin-left bg-amber" style={{ transform: `scaleX(${(video.encode_progress || 0) / 100})` }} />
          </span>
        )}
      </button>
      <div className="flex items-start gap-2 border-t border-gray-400 px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate copy-14 font-medium">{video.title}</p>
          <p className="truncate copy-13">{video.campaign_name || <span className="text-gray-700">Unassigned</span>}</p>
          <p className="mt-1 flex flex-wrap gap-1">
            <Badge tone={meta.tone}>
              {meta.label}
              {video.status === 'processing' && video.encode_progress ? ` ${video.encode_progress}%` : ''}
            </Badge>
            {video.placements.map((p) => (
              <Badge key={p}>{placementLabel(p)}</Badge>
            ))}
          </p>
          {video.width > 0 && <p className="mt-1 font-mono copy-12 text-gray-900">{`${video.width}×${video.height}`}{video.provider === 'external' ? ' · by URL' : ''}</p>}
          {video.error && (
            <p className="mt-1 flex items-start gap-1 copy-13 text-red-text">
              <CircleAlert size={14} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0" /> {video.error}
            </p>
          )}
        </div>
        {canWrite && (
          <Menu
            label={`Actions for ${video.title}`}
            trigger={(props) => <IconButton {...props} icon={Ellipsis} label={`Actions for ${video.title}`} />}
            items={[
              video.status === 'ready' && { label: 'Preview', onSelect: onPreview },
              { label: 'Edit', onSelect: onEdit },
              video.provider === 'bunny' && video.status !== 'archived' && { label: 'Check status now', onSelect: onSync },
              video.status !== 'archived' && { label: 'Archive', onSelect: onArchive },
              video.status === 'archived' && { label: 'Unarchive', onSelect: onUnarchive },
              { label: 'Delete', onSelect: onDelete, danger: true },
            ].filter(Boolean)}
          />
        )}
      </div>
    </li>
  );
}

export function Videos() {
  const { videos, storage, limits, campaigns, status } = useLoaderData();
  const revalidator = useRevalidator();
  const canWrite = useCanWrite();
  const [, setSearchParams] = useSearchParams();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [externalOpen, setExternalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [previewing, setPreviewing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  // Refresh while anything is still uploading or processing, and only then.
  const moving = videos.some((v) => ['uploaded', 'processing'].includes(v.status));
  useEffect(() => {
    if (!moving) return undefined;
    const timer = setInterval(() => {
      invalidate();
      revalidator.revalidate();
    }, 8000);
    return () => clearInterval(timer);
  }, [moving, revalidator]);

  const refresh = () => revalidator.revalidate();
  const action = (fn, done) => async () => {
    try {
      await fn();
      await refresh();
      if (done) toast.success(done);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <>
      <PageHeader
        title="Creatives"
        description="Video ads play from Bunny Stream's CDN and never autoplay. Attach them to campaigns with a video format."
        actions={
          canWrite && (
            <>
              <Button icon={Link2} onClick={() => setExternalOpen(true)}>
                Add by URL
              </Button>
              <Button variant="primary" icon={Upload} disabled={!storage.bunny.configured} onClick={() => setUploadOpen(true)}>
                Upload video
              </Button>
            </>
          )
        }
      />
      <LibraryTabs active="videos" />

      {!storage.bunny.configured && (
        <div className="mb-6 rounded-md border border-amber-border bg-amber-soft px-4 py-3 copy-14 text-amber-text">
          Bunny Stream is not configured, so uploads are off. Set <code className="font-mono">BUNNY_STREAM_LIBRARY_ID</code>, <code className="font-mono">BUNNY_STREAM_API_KEY</code>, and <code className="font-mono">BUNNY_STREAM_CDN_HOST</code> on the ad server. Videos added by URL work without it.
        </div>
      )}
      {storage.bunny.configured && (
        <p className="mb-4 flex flex-wrap gap-3 copy-13 text-gray-900">
          <span className="inline-flex items-center gap-1">
            <CircleCheck size={14} strokeWidth={1.5} aria-hidden="true" className="text-green-text" /> Bunny Stream connected
          </span>
          <span>{storage.bunny.signedPlayback ? 'Playback URLs are signed' : 'Playback URLs are not signed (set BUNNY_STREAM_TOKEN_KEY)'}</span>
          <span>{storage.bunny.webhooks ? 'Webhooks verified' : 'No webhook key; status is polled every minute'}</span>
        </p>
      )}

      <Segmented label="Filter by status" size="sm" className="mb-4" value={status} options={FILTERS} onChange={(value) => setSearchParams(value ? { status: value } : {}, { replace: true })} />

      {videos.length === 0 ? (
        <div className="rounded-md border border-gray-400 px-4 py-16">
          <EmptyState icon={Film} title={status ? 'No videos with this status' : 'No videos yet'} description="Upload a video to Bunny Stream, or link an MP4 hosted on an allowed host." />
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              canWrite={canWrite}
              onPreview={() => setPreviewing(video)}
              onEdit={() => setEditing(video)}
              onSync={action(() => post(api(`/videos/${video.id}/sync`)), 'Status refreshed')}
              onArchive={action(() => post(api(`/videos/${video.id}/archive`)), 'Archived. It no longer serves.')}
              onUnarchive={action(() => post(api(`/videos/${video.id}/unarchive`)), video.provider === 'bunny' ? 'Unarchived. It serves again once Bunny reports it ready.' : 'Unarchived. It serves again.')}
              onDelete={() => setDeleting(video)}
            />
          ))}
        </ul>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} campaigns={campaigns} limits={limits} onDone={refresh} />
      <ExternalVideoModal open={externalOpen} onClose={() => setExternalOpen(false)} campaigns={campaigns} hosts={storage.externalHosts} maxDuration={limits.maxDurationSeconds} onDone={refresh} />
      {editing && <EditModal key={editing.id} video={editing} campaigns={campaigns} onClose={() => setEditing(null)} onDone={refresh} />}
      <VideoPreview video={previewing} onClose={() => setPreviewing(null)} />
      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={action(() => del(api(`/videos/${deleting.id}`)), 'Deleted video')}
        title="Delete video"
        description={deleting?.provider === 'bunny' ? 'This deletes the video from Bunny Stream too. Its stats are kept. Archive instead if you may want it back.' : 'This removes the video from your library. Its stats are kept.'}
        confirmLabel="Delete video"
      />
    </>
  );
}
