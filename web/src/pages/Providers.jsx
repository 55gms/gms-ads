import { CircleCheck, CircleMinus } from 'lucide-react';
import { useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';
import { api, errorMessage, fieldErrors, get, patch } from '../lib/api.js';
import { FORMAT_LABELS } from '../lib/campaign.js';
import { useSession } from '../lib/session.js';
import { toast } from '../lib/stores.js';
import { Badge } from '../ui/Badge.jsx';
import { Button } from '../ui/Button.jsx';
import { Checkbox, Switch } from '../ui/Controls.jsx';
import { Field, Input } from '../ui/Field.jsx';

export const providersLoader = () => get(api('/providers'));

const CAPABILITY_LABELS = [
  ['rewarded', 'Rewarded ads'],
  ['userInitiated', 'Starts only when the viewer chooses'],
  ['serverVerifiedReward', 'Reward verified by the ad server'],
  ['reliableCompletion', 'Reliable completion events'],
  ['configurableSkip', 'Skip time set here'],
];

const STATUS_TONE = { ok: 'green', unconfigured: 'gray', error: 'red' };

function ProviderCard({ provider, canEdit, onSaved }) {
  const [enabled, setEnabled] = useState(provider.enabled);
  const [formats, setFormats] = useState(provider.formats);
  const [priority, setPriority] = useState(String(provider.priority));
  const [config, setConfig] = useState(provider.config || {});
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const firstParty = provider.type === 'first_party';
  const setCfg = (key) => (e) => setConfig({ ...config, [key]: e.target.value });

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      await patch(api(`/providers/${provider.id}`), firstParty ? { formats, priority: Number(priority) } : { enabled, formats, priority: Number(priority), config });
      toast.success(`Saved ${provider.name}`);
      onSaved();
    } catch (error) {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="rounded-md border border-gray-400">
      <div className="flex flex-wrap items-start gap-3 border-b border-gray-400 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 heading-16">
            {provider.name}
            <Badge tone={STATUS_TONE[provider.status]}>{provider.status === 'ok' ? 'Configured' : provider.status === 'unconfigured' ? 'Needs setup' : 'Error'}</Badge>
            {provider.enabled ? <Badge tone="blue">Enabled</Badge> : <Badge>Off</Badge>}
          </p>
          <p className="mt-1 copy-13 text-gray-900">{provider.capabilities.note}</p>
        </div>
        {!firstParty && <Switch checked={enabled} onChange={setEnabled} disabled={!canEdit} label={`Enable ${provider.name}`} />}
      </div>
      <div className="grid gap-6 px-4 py-4 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="copy-13 font-medium text-gray-900">Formats</legend>
            <div className="mt-2 flex flex-col gap-1">
              {provider.capabilities.formats.map((f) => (
                <Checkbox key={f} disabled={!canEdit} checked={formats.includes(f)} onChange={() => setFormats(formats.includes(f) ? formats.filter((x) => x !== f) : [...formats, f])}>
                  {FORMAT_LABELS[f]}
                </Checkbox>
              ))}
            </div>
            {errors.formats && <p role="alert" className="mt-1 copy-13 text-red-text">{errors.formats}</p>}
          </fieldset>
          <Field label="Fallback order" hint="Lower runs first when first-party campaigns have no fill." error={errors.priority}>
            {(props) => <Input {...props} inputMode="numeric" className="w-28" disabled={!canEdit} value={priority} onChange={(e) => setPriority(e.target.value)} />}
          </Field>
          {provider.type === 'google_h5' && (
            <>
              <Field label="Publisher ID" error={errors.client} hint="From an AdSense account approved for H5 Games Ads.">
                {(props) => <Input {...props} mono placeholder="ca-pub-0000000000000000" disabled={!canEdit} value={config.client || ''} onChange={setCfg('client')} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Frequency hint" error={errors.frequencyHint}>
                  {(props) => <Input {...props} mono disabled={!canEdit} value={config.frequencyHint || '30s'} onChange={setCfg('frequencyHint')} />}
                </Field>
                <Field label="Channel" optional error={errors.channel}>
                  {(props) => <Input {...props} mono disabled={!canEdit} value={config.channel || ''} onChange={setCfg('channel')} />}
                </Field>
              </div>
              <Checkbox disabled={!canEdit} checked={config.testMode !== false} onChange={(v) => setConfig({ ...config, testMode: v })}>
                Test mode (data-adbreak-test). Turn off only after Google approves the site.
              </Checkbox>
            </>
          )}
          {provider.type === 'vast' && (
            <Field label="VAST tag URL" error={errors.tagUrl} hint="Fetched by the viewer's browser. [CACHEBUSTING] and [TIMESTAMP] are filled in.">
              {(props) => <Input {...props} mono type="url" disabled={!canEdit} value={config.tagUrl || ''} onChange={setCfg('tagUrl')} />}
            </Field>
          )}
          {errors.enabled && <p role="alert" className="copy-13 text-red-text">{errors.enabled}</p>}
        </div>
        <div>
          <p className="copy-13 font-medium text-gray-900">What it can do</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {CAPABILITY_LABELS.map(([key, label]) => (
              <li key={key} className="flex items-center gap-2 copy-13">
                {provider.capabilities[key] ? <CircleCheck size={15} strokeWidth={1.5} className="text-green-text" aria-label="Yes" /> : <CircleMinus size={15} strokeWidth={1.5} className="text-gray-700" aria-label="No" />}
                {label}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {canEdit && (
        <div className="flex justify-end border-t border-gray-400 px-4 py-3">
          <Button type="submit" variant="primary" size="sm" loading={saving}>
            Save
          </Button>
        </div>
      )}
    </form>
  );
}

export function Providers() {
  const { providers } = useLoaderData();
  const { user } = useSession();
  const revalidator = useRevalidator();
  const canEdit = ['owner', 'admin'].includes(user.role);
  return (
    <>
      <div className="mb-4">
        <h2 className="heading-20">Ad providers</h2>
        <p className="mt-1 copy-14 text-gray-900">
          Video requests try first-party campaigns, then enabled providers in order. Settings here are public identifiers only. Provider-reported events appear in video analytics under the provider and are never mixed into campaign numbers.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {providers.map((p) => (
          <ProviderCard key={`${p.id}-${p.updatedAt}`} provider={p} canEdit={canEdit} onSaved={() => revalidator.revalidate()} />
        ))}
      </div>
    </>
  );
}
