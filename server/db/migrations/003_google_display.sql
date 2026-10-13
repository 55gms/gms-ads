-- Google display ads on approved sites. The Google provider's config gains
-- `displaySlot` (an AdSense display unit) and `domains` (hostname patterns the
-- AdSense account is approved for). Banner slots on those sites are filled by
-- Google; its video formats are limited to the same sites.

-- 55gms.com is the only approved site so far. Publisher and slot IDs are
-- public: they appear in the page source wherever the unit runs. A provider
-- that was off keeps its H5 video formats off, since AdSense approval alone
-- does not cover them.
UPDATE ad_providers
   SET name = 'Google AdSense',
       config = config
         || jsonb_build_object('displaySlot', '5418331219', 'domains', jsonb_build_array('55gms.com', '*.55gms.com'))
         || CASE WHEN coalesce(config->>'client', '') = '' THEN jsonb_build_object('client', 'ca-pub-7654077519249449') ELSE '{}'::jsonb END,
       formats = CASE WHEN enabled THEN formats ELSE '{}' END,
       enabled = true,
       status = 'ok',
       updated_at = now()
 WHERE id = 'google_h5';
