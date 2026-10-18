-- Authometry moved from authometry.ch3n.cc to authometry.jiayangchen.com. Users
-- are keyed on (iss, sub), so move existing accounts to the new issuer or their
-- next sign-in would create a fresh, pending account.

UPDATE users o SET iss = 'https://authometry.jiayangchen.com'
 WHERE rtrim(o.iss, '/') = 'https://authometry.ch3n.cc'
   AND NOT EXISTS (
     SELECT 1 FROM users n WHERE n.iss = 'https://authometry.jiayangchen.com' AND n.sub = o.sub
   );
