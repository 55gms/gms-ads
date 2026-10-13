// Video campaign selection. Pure, and built from the same pieces as image
// selection (schedule, domain targeting, weights, budgets), with format
// eligibility in place of slot sizes.

import { domainAllowed, inSchedule, pickWeighted } from '../../../shared/selection.js';

// campaigns: [{ id, weight, startsAt, endsAt, targeting, formats, creatives: [{ id, placements, ... }] }]
export function eligibleVideo(campaigns, { format, domain, now = Date.now(), remaining, exclude } = {}) {
  const out = [];
  for (const campaign of campaigns) {
    if (!campaign.formats?.includes(format)) continue;
    if (exclude && exclude.has(campaign.id)) continue;
    if (!inSchedule(campaign, now)) continue;
    if (!domainAllowed(campaign.targeting, domain)) continue;
    if (remaining && !(remaining(campaign) > 0)) continue;
    // A video creative serves only in the placements it was cleared for.
    const creatives = campaign.creatives.filter((cr) => cr.placements.includes(format));
    if (creatives.length) out.push({ campaign, creatives });
  }
  return out;
}

export function selectVideo(campaigns, options = {}) {
  const rng = options.rng || Math.random;
  const pool = eligibleVideo(campaigns, options);
  const chosen = pickWeighted(pool, (e) => e.campaign.weight, rng);
  if (!chosen) return null;
  const creative = chosen.creatives[Math.floor(rng() * chosen.creatives.length)] || chosen.creatives[0];
  return { campaign: chosen.campaign, creative };
}
