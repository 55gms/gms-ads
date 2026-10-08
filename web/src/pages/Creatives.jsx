import { CircleAlert, CircleCheck, Image as ImageIcon, Link2, Trash2, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import { api, del, errorMessage, fieldErrors, get, http, invalidate, post } from '../lib/api.js';
import { cx } from '../lib/cx.js';
import { bytes, sizeLabel } from '../lib/format.js';
import { useCanWrite, useSession } from '../lib/session.js';
import { toast } from '../lib/stores.js';
import { SourceBadge } from '../ui/Badge.jsx';
import { Button, IconButton } from '../ui/Button.jsx';
import { Checkbox } from '../ui/Controls.jsx';
import { Field, Input, Select } from '../ui/Field.jsx';
import { EmptyState, PageHeader } from '../ui/Misc.jsx';
import { ConfirmModal, Modal } from '../ui/Overlay.jsx';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';

export async function creativesLoader() {
  const [creatives, sizes] = await Promise.all([get(api('/creatives')), get(api('/settings/sizes'))]);
  return { creatives: creatives.creatives, sizes: sizes.sizes };
}

const readDimensions = (file) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

let uploadId = 0;

// Drop zone plus a queue. A file whose dimensions match an ad size uploads
// straight away; anything else waits for a size and the resize choice.
function Uploader({ sizes, maxBytes, onUploaded }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState([]);
  const update = (id, changes) => setQueue((list) => list.map((item) => (item.id === id ? { ...item, ...changes } : item)));

  const start = async (item) => {
    update(item.id, { status: 'uploading', progress: 0, error: null });
    const body = new FormData();
    body.append('file', item.file);
    body.append('sizeId', item.sizeId);
    body.append('resize', String(item.resize));
    try {
      await http.post(api('/creatives/upload'), body, { onUploadProgress: (e) => update(item.id, { progress: e.total ? e.loaded / e.total : 0 }) });
      invalidate();
      update(item.id, { status: 'done', progress: 1 });
      onUploaded();
    } catch (error) {
      update(item.id, { status: 'error', error: errorMessage(error, 'Upload failed') });
    }
  };

  const addFiles = async (files) => {
    for (const file of files) {
      const id = ++uploadId;
      if (file.size > maxBytes) {
        setQueue((list) => [...list, { id, file, status: 'error', error: 'File is larger than 2 MB' }]);
        continue;
      }
      const dims = await readDimensions(file);
      const match = dims && sizes.find((s) => s.width === dims.width && s.height === dims.height);
      const item = { id, file, dims, sizeId: match?.id || '', resize: false, status: match ? 'uploading' : 'ready', progress: 0 };
      setQueue((list) => [...list, item]);
      if (match) start(item);
    }
  };

  return (
    <div className="mb-8">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles([...e.dataTransfer.files]);
        }}
        className={cx('flex flex-col items-center rounded-md border border-dashed px-4 py-8 text-center ease-hover', dragging ? 'border-blue bg-blue-soft' : 'border-gray-500 bg-background-200')}
      >
        <Upload size={20} strokeWidth={1.5} aria-hidden="true" className={cx('transition-transform duration-[120ms] ease-out', dragging ? '-translate-y-0.5 text-blue-text' : 'text-gray-900')} />
        <p className="mt-3 copy-14 font-medium">{dragging ? 'Drop to upload' : 'Drag images here'}</p>
        <p className="mt-1 copy-13 text-gray-900">PNG, JPEG, WebP, GIF, or AVIF up to 2 MB. The size is detected from the image.</p>
        <Button size="sm" className="mt-4" onClick={() => inputRef.current?.click()}>
          Choose files
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose images to upload"
          onChange={(e) => {
            addFiles([...e.target.files]);
            e.target.value = '';
          }}
        />
      </div>

      {queue.length > 0 && (
        <ul className="mt-3 overflow-hidden rounded-md border border-gray-400" aria-label="Uploads">
          {queue.map((item) => (
            <li key={item.id} className="border-b border-gray-400 px-4 py-3 last:border-0">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate copy-14">{item.file.name}</p>
                  <p className="font-mono copy-12 text-gray-900">
                    {item.dims ? sizeLabel(`${item.dims.width}x${item.dims.height}`) : 'Unknown size'} · {bytes(item.file.size)}
                  </p>
                </div>
                {item.status === 'ready' && (
                  <>
                    <Select size="sm" aria-label="Ad size" className="w-40" value={item.sizeId} onChange={(e) => update(item.id, { sizeId: e.target.value })}>
                      <option value="">Pick a size</option>
                      {sizes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {sizeLabel(`${s.width}x${s.height}`)} {s.name}
                        </option>
                      ))}
                    </Select>
                    <Checkbox checked={item.resize} onChange={(resize) => update(item.id, { resize })}>
                      Resize to fit
                    </Checkbox>
                    <Button size="sm" variant="primary" disabled={!item.sizeId || Boolean(item.dims && !item.resize)} onClick={() => start(item)}>
                      Upload creative
                    </Button>
                  </>
                )}
                {item.status === 'done' && (
                  <span className="flex items-center gap-1.5 copy-13 text-green-text">
                    <CircleCheck size={16} strokeWidth={1.5} aria-hidden="true" /> Uploaded
                  </span>
                )}
                {item.status === 'error' && (
                  <span role="alert" className="flex items-center gap-1.5 copy-13 text-red-text">
                    <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" /> {item.error}
                  </span>
                )}
                {item.status !== 'uploading' && <IconButton icon={X} label={`Remove ${item.file.name} from the list`} onClick={() => setQueue((list) => list.filter((x) => x.id !== item.id))} />}
              </div>
              {item.status === 'ready' && !item.resize && <p className="mt-2 copy-13 text-gray-900">This image does not match a standard size. Pick the size it should fill and tick “Resize to fit”.</p>}
              {item.status === 'uploading' && (
                <div role="progressbar" aria-label={`Uploading ${item.file.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress * 100)} className="mt-2 h-1 overflow-hidden rounded-full bg-gray-300">
                  <div style={{ transform: `scaleX(${item.progress})` }} className="h-full origin-left bg-blue transition-transform duration-[120ms] ease-standard" />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ExternalModal({ open, onClose, sizes, hosts, onAdded }) {
  const [form, setForm] = useState({ url: '', sizeId: '', altText: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    const next = {};
    if (!/^https:\/\/\S+$/.test(form.url.trim())) next.url = 'Enter an https:// image URL';
    if (!form.sizeId) next.sizeId = 'Pick the size this image is';
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      await post(api('/creatives/external'), { url: form.url.trim(), sizeId: form.sizeId, altText: form.altText });
      setForm({ url: '', sizeId: '', altText: '' });
      onAdded();
      onClose();
      toast.success('Added creative from URL');
    } catch (error) {
      // The server's checks (host, DNS, type, dimensions) all concern the URL.
      setErrors({ url: errorMessage(error), ...fieldErrors(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add from URL"
      description={hosts.length ? `The image stays on its host. Allowed hosts: ${hosts.join(', ')}.` : 'The image stays on its host and is checked once for type and dimensions.'}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="external-form" loading={saving}>
            Add creative
          </Button>
        </>
      }
    >
      <form id="external-form" onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Image URL" error={errors.url}>
          {(props) => <Input {...props} data-autofocus type="url" mono placeholder="https://cdn.jsdelivr.net/gh/user/repo@v1/ad.png" value={form.url} onChange={set('url')} />}
        </Field>
        <Field label="Size" error={errors.sizeId}>
          {(props) => (
            <Select {...props} value={form.sizeId} onChange={set('sizeId')}>
              <option value="">Pick a size</option>
              {sizes.map((s) => (
                <option key={s.id} value={s.id}>
                  {sizeLabel(`${s.width}x${s.height}`)} {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Alt text" optional>
          {(props) => <Input {...props} maxLength={200} value={form.altText} onChange={set('altText')} />}
        </Field>
      </form>
    </Modal>
  );
}

function Preview({ open, creative, onClose }) {
  return (
    <Modal open={open} onClose={onClose} title={creative ? `${sizeLabel(creative.size)} creative` : ''} width="max-w-[1040px]" footer={<Button onClick={onClose}>Close</Button>}>
      {creative && (
        <>
          {/* Shown at its real pixel size inside a frame of exactly that size. */}
          <div className="overflow-auto rounded-md border border-gray-400 bg-background-200 p-6">
            <div style={{ width: creative.width, height: creative.height }} className="mx-auto outline-1 outline-gray-alpha-300">
              <img src={creative.image_url} alt={creative.alt_text || 'Creative preview'} width={creative.width} height={creative.height} />
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 copy-13 md:grid-cols-4">
            {[
              ['Dimensions', sizeLabel(creative.size)],
              ['File size', bytes(creative.bytes)],
              ['Type', creative.mime.replace('image/', '').toUpperCase()],
              ['Campaign', creative.campaign_name || 'Unassigned'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-gray-900">{label}</dt>
                <dd className={label === 'Campaign' ? '' : 'font-mono'}>{value}</dd>
              </div>
            ))}
          </dl>
          {creative.source === 'external' && <p className="mt-3 font-mono copy-12 break-all text-gray-900">{creative.external_url}</p>}
        </>
      )}
    </Modal>
  );
}

export function Creatives() {
  const { creatives, sizes } = useLoaderData();
  const { config } = useSession();
  const revalidator = useRevalidator();
  const canWrite = useCanWrite();
  const [searchParams, setSearchParams] = useSearchParams();
  const [externalOpen, setExternalOpen] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const previewing = creatives.find((c) => c.id === searchParams.get('preview')) || null;
  // Held so the modal keeps its content while it animates out.
  const [lastPreview, setLastPreview] = useState(previewing);
  if (previewing && previewing !== lastPreview) setLastPreview(previewing);

  const groups = [];
  for (const creative of creatives) {
    const group = groups.find((g) => g.size === creative.size);
    if (group) group.items.push(creative);
    else groups.push({ size: creative.size, items: [creative] });
  }

  const remove = async () => {
    try {
      await del(api(`/creatives/${deleting.id}`));
      await revalidator.revalidate();
      toast.success('Deleted creative');
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    }
  };

  return (
    <>
      <PageHeader
        title="Creatives"
        description="Images grouped by ad size. Attach them to campaigns from the campaign editor."
        actions={
          canWrite && (
            <Button icon={Link2} onClick={() => setExternalOpen(true)}>
              Add from URL
            </Button>
          )
        }
      />
      {canWrite && <Uploader sizes={sizes} maxBytes={config.maxUploadBytes} onUploaded={() => revalidator.revalidate()} />}

      {groups.length === 0 ? (
        <div className="rounded-md border border-gray-400 px-4 py-16">
          <EmptyState icon={ImageIcon} title="No creatives yet" description="Upload an image or link one hosted on jsDelivr to get started." />
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.size} className="mb-8">
            <h2 className="mb-3 flex items-baseline gap-2">
              <span className="font-mono text-[16px] leading-6 font-semibold tabular">{sizeLabel(group.size)}</span>
              <span className="copy-13 text-gray-900">
                {group.items.length} {group.items.length === 1 ? 'creative' : 'creatives'}
              </span>
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((creative) => (
                <li key={creative.id} className="group overflow-hidden rounded-md border border-gray-400 ease-hover hover:border-gray-500">
                  <button type="button" onClick={() => setSearchParams({ preview: creative.id })} aria-label={`Preview ${sizeLabel(creative.size)} creative${creative.alt_text ? `: ${creative.alt_text}` : ''}`} className="grid h-40 w-full place-items-center bg-background-200 p-4">
                    <img src={creative.image_url} alt="" loading="lazy" className="max-h-full max-w-full object-contain transition-transform duration-[200ms] ease-out group-hover:scale-[1.02]" />
                  </button>
                  <div className="flex items-center gap-2 border-t border-gray-400 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate copy-13">{creative.campaign_name || <span className="text-gray-700">Unassigned</span>}</p>
                      <p className="font-mono copy-12 text-gray-900">
                        {sizeLabel(`${creative.width}x${creative.height}`)} · {bytes(creative.bytes)}
                      </p>
                    </div>
                    <SourceBadge source={creative.source} />
                    {canWrite && <IconButton icon={Trash2} label="Delete creative" onClick={() => setDeleting(creative)} />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <ExternalModal open={externalOpen} onClose={() => setExternalOpen(false)} sizes={sizes} hosts={config.externalImageHosts} onAdded={() => revalidator.revalidate()} />
      <Preview open={Boolean(previewing)} creative={previewing || lastPreview} onClose={() => setSearchParams({}, { replace: true })} />
      <ConfirmModal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        title="Delete creative"
        description={deleting?.campaign_name ? `This creative is used by ${deleting.campaign_name}. Deleting it removes it from that campaign. This cannot be undone.` : 'This removes the creative from your library. This cannot be undone.'}
        confirmLabel="Delete creative"
      />
    </>
  );
}
