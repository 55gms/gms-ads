// A campaign's displayed state: its stored status refined by its schedule.
export function campaignState(campaign, now = Date.now()) {
  if (campaign.status === 'active') {
    if (campaign.ends_at && new Date(campaign.ends_at).getTime() <= now) return 'ended';
    if (campaign.starts_at && new Date(campaign.starts_at).getTime() > now) return 'scheduled';
  }
  return campaign.status;
}

// "Oct 1 – Oct 31", "From Oct 1", "Until Oct 31", or "Always".
export function scheduleLabel(campaign, fmt) {
  const { starts_at: start, ends_at: end } = campaign;
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  if (end) return `Until ${fmt(end)}`;
  return 'Always';
}
