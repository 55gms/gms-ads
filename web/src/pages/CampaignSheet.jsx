import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage, fieldErrors, patch, post } from '../lib/api.js';
import { cx } from '../lib/cx.js';
import { fromLocalInput, sizeLabel, toLocalInput } from '../lib/format.js';
import { useLocalDraft } from '../lib/hooks.js';
import { toast } from '../lib/stores.js';
import { Button } from '../ui/Button.jsx';
import { Combobox } from '../ui/Combobox.jsx';
import { RadioGroup, Slider } from '../ui/Controls.jsx';
import { Field, Input, Select } from '../ui/Field.jsx';
import { Modal, Sheet } from '../ui/Overlay.jsx';

const EMPTY = {
  name: '',
  clickUrl: '',
  weight: 50,
  status: 'draft',
  startsAt: '',
  endsAt: '',
  totalCap: '',
  dailyCap: '',
  targetingMode: 'all',
  domainIds: [],
  creativeIds: [],
};

const fromCampaign = (c) => ({
  name: c.name,
  clickUrl: c.click_url,
  weight: c.weight,
  status: c.status,
  startsAt: toLocalInput(c.starts_at),
  endsAt: toLocalInput(c.ends_at),
  totalCap: c.total_impression_cap ? String(c.total_impression_cap) : '',
  dailyCap: c.daily_impression_cap ? String(c.daily_impression_cap) : '',
  targetingMode: c.targeting_mode,
  domainIds: c.domain_ids || [],
  creativeIds: c.creatives.map((cr) => cr.id),
});

function validate(form) {
  const errors = {};
  if (!form.name.trim()) errors.name = 'Give the campaign a name';
  try {
    const url = new URL(form.clickUrl);
    if (url.protocol !== 'https:') errors.clickUrl = 'Must start with https://';
  } catch {
    errors.clickUrl = form.clickUrl ? 'Enter a full URL, such as https://example.com/landing' : 'Enter where clicks should go';
  }
  if (form.startsAt && form.endsAt && form.endsAt <= form.startsAt) errors.endsAt = 'End must be after start';
  for (const field of ['totalCap', 'dailyCap']) {
    if (form[field] && !/^[1-9]\d*$/.test(form[field])) errors[field] = 'Enter a whole number above zero';
  }
  if (!errors.totalCap && !errors.dailyCap && form.totalCap && form.dailyCap && Number(form.dailyCap) > Number(form.totalCap)) {
    errors.dailyCap = 'Daily cap cannot exceed the total cap';
  }
  if (form.targetingMode !== 'all' && form.domainIds.length === 0) errors.domainIds = 'Pick at least one domain';
  return errors;
}

// API field names mapped back to this form's field names.
const SERVER_FIELDS = { totalImpressionCap: 'totalCap', dailyImpressionCap: 'dailyCap' };

export function CampaignSheet({ open, campaign, creatives, domains, onClose, onSaved }) {
  const baseline = useMemo(() => (campaign ? fromCampaign(campaign) : EMPTY), [campaign]);
  // Autosaved locally so a closed tab or accidental navigation loses nothing.
  const [form, setForm, clearDraft] = useLocalDraft(`campaign-draft:${campaign?.id || 'new'}`, baseline);
  const [touched, setTouched] = useState({});
  const [serverErrors, setServerErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const errors = { ...validate(form), ...serverErrors };
  const show = (field) => (touched[field] || submitted ? errors[field] : undefined);
  const set = (field) => (value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (serverErrors[field]) setServerErrors((prev) => ({ ...prev, [field]: undefined }));
  };
  const input = (field) => ({ value: form[field], onChange: (e) => set(field)(e.target.value), onBlur: () => setTouched((prev) => ({ ...prev, [field]: true })) });

  const domainOptions = useMemo(() => domains.map((d) => ({ value: d.id, label: d.hostname })), [domains]);

  // Creatives this campaign can use: its own plus any not attached elsewhere.
  const bySize = useMemo(() => {
    const groups = new Map();
    for (const creative of creatives) {
      if (creative.campaign_id && creative.campaign_id !== campaign?.id) continue;
      if (!groups.has(creative.size)) groups.set(creative.size, []);
      groups.get(creative.size).push(creative);
    }
    return [...groups].sort((a, b) => parseInt(b[0], 10) - parseInt(a[0], 10));
  }, [creatives, campaign]);

  const toggleCreative = (id) => set('creativeIds')(form.creativeIds.includes(id) ? form.creativeIds.filter((x) => x !== id) : [...form.creativeIds, id]);

  const requestClose = () => (dirty ? setConfirmClose(true) : onClose());
  const discard = () => {
    clearDraft();
    setConfirmClose(false);
    onClose();
  };

  const submit = async (event) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.values(validate(form)).some(Boolean)) return;
    setSaving(true);
    const body = {
      name: form.name.trim(),
      clickUrl: form.clickUrl.trim(),
      weight: form.weight,
      status: form.status,
      startsAt: fromLocalInput(form.startsAt),
      endsAt: fromLocalInput(form.endsAt),
      totalImpressionCap: form.totalCap ? Number(form.totalCap) : null,
      dailyImpressionCap: form.dailyCap ? Number(form.dailyCap) : null,
      targetingMode: form.targetingMode,
      domainIds: form.targetingMode === 'all' ? [] : form.domainIds,
      creativeIds: form.creativeIds,
    };
    try {
      const { campaign: saved } = campaign ? await patch(api(`/campaigns/${campaign.id}`), body) : await post(api('/campaigns'), body);
      clearDraft();
      await onSaved(saved, !campaign);
    } catch (error) {
      const fields = Object.fromEntries(Object.entries(fieldErrors(error)).map(([k, v]) => [SERVER_FIELDS[k] || k, v]));
      setServerErrors(fields);
      toast.error(errorMessage(error, 'Could not save the campaign'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={requestClose}
        title={campaign ? 'Edit campaign' : 'New campaign'}
        description={dirty ? 'Unsaved changes are kept as a draft on this device.' : 'Changes reach the edge within about a minute.'}
        footer={
          <>
            <Button onClick={requestClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="campaign-form" loading={saving}>
              {campaign ? 'Save changes' : 'Create campaign'}
            </Button>
          </>
        }
      >
        <form id="campaign-form" onSubmit={submit} noValidate className="flex flex-col gap-6">
          <Field label="Name" error={show('name')}>
            {(props) => <Input {...props} {...input('name')} data-autofocus maxLength={120} placeholder="Autumn sale" />}
          </Field>
          <Field label="Click URL" hint="Where a click on any creative in this campaign goes." error={show('clickUrl')}>
            {(props) => <Input {...props} {...input('clickUrl')} type="url" inputMode="url" placeholder="https://example.com/landing" mono />}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              {(props) => (
                <Select {...props} value={form.status} onChange={(e) => set('status')(e.target.value)}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                </Select>
              )}
            </Field>
            <Field label={<>Weight <span className="ml-1 font-mono text-gray-1000 tabular">{form.weight}</span></>} hint="Relative share against other campaigns at the same size.">
              {(props) => <Slider {...props} value={form.weight} onChange={set('weight')} min={1} max={100} />}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Starts" optional error={show('startsAt')}>
              {(props) => <Input {...props} {...input('startsAt')} type="datetime-local" />}
            </Field>
            <Field label="Ends" optional error={show('endsAt')}>
              {(props) => <Input {...props} {...input('endsAt')} type="datetime-local" min={form.startsAt || undefined} />}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Total impression cap" optional error={show('totalCap')}>
              {(props) => <Input {...props} {...input('totalCap')} inputMode="numeric" placeholder="No limit" suffix="imps" />}
            </Field>
            <Field label="Daily impression cap" optional hint="Resets at 00:00 UTC." error={show('dailyCap')}>
              {(props) => <Input {...props} {...input('dailyCap')} inputMode="numeric" placeholder="No limit" suffix="imps" />}
            </Field>
          </div>

          <div className="flex flex-col gap-3">
            <RadioGroup
              label="Domains"
              value={form.targetingMode}
              onChange={set('targetingMode')}
              options={[
                { value: 'all', label: 'All domains' },
                { value: 'include', label: 'Only these domains' },
                { value: 'exclude', label: 'All except these domains' },
              ]}
            />
            {form.targetingMode !== 'all' && (
              <Field error={show('domainIds')} hint={domains.length === 0 ? 'No domains registered yet. Add them on the Domains page first.' : undefined}>
                {(props) => <Combobox {...props} options={domainOptions} value={form.domainIds} onChange={set('domainIds')} placeholder="Search domains" emptyText="No matching domains" mono />}
              </Field>
            )}
          </div>

          <fieldset>
            <legend className="copy-13 font-medium text-gray-900">Creatives</legend>
            <p className="mt-1 copy-13 text-gray-900">One or more per size. A slot shows this campaign only in sizes it has a creative for.</p>
            {bySize.length === 0 ? (
              <p className="mt-3 rounded-md border border-dashed border-gray-400 p-4 copy-13 text-gray-900">
                No creatives available.{' '}
                <Link to="/creatives" className="text-blue-text underline-offset-2 hover:underline">
                  Upload a creative
                </Link>{' '}
                first; your draft is kept.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-4">
                {bySize.map(([size, list]) => (
                  <div key={size}>
                    <p className="mb-2 font-mono copy-12 text-gray-900">{sizeLabel(size)}</p>
                    <div className="flex flex-wrap gap-2">
                      {list.map((creative) => {
                        const selected = form.creativeIds.includes(creative.id);
                        return (
                          <button
                            key={creative.id}
                            type="button"
                            role="checkbox"
                            aria-checked={selected}
                            aria-label={`${sizeLabel(size)} creative${creative.alt_text ? `: ${creative.alt_text}` : ''}`}
                            onClick={() => toggleCreative(creative.id)}
                            className={cx('relative grid h-16 w-28 place-items-center overflow-hidden rounded-sm border bg-background-200 p-1 ease-hover', selected ? 'border-blue outline-2 -outline-offset-1 outline-blue' : 'border-gray-400 hover:border-gray-500')}
                          >
                            <img src={creative.image_url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
        </form>
      </Sheet>

      <Modal
        open={confirmClose}
        onClose={() => setConfirmClose(false)}
        title="Discard unsaved changes?"
        description="Your edits to this campaign will be lost."
        footer={
          <>
            <Button onClick={() => setConfirmClose(false)}>Keep editing</Button>
            <Button variant="error" onClick={discard}>
              Discard changes
            </Button>
          </>
        }
      />
    </>
  );
}
