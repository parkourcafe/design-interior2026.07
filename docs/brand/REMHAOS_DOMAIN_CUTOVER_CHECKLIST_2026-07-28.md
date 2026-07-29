# RemhaOS Domain Cutover Checklist — 2026-07-28

## Code/config implemented

- Primary canonical host in generated metadata/discovery files: `https://remhaos.com`.
- `next.config.mjs` contains one-hop permanent redirects:
  - `https://arhidom.space/:path*` → `https://remhaos.com/:path*`
  - `https://www.arhidom.space/:path*` → `https://remhaos.com/:path*`
  - `https://www.remhaos.com/:path*` → `https://remhaos.com/:path*`
- Path preservation is configured through `:path*`.
- Query preservation is handled by Next.js redirects unless Vercel host-level configuration overrides it.
- Private/token routes are disallowed in `robots.ts`.
- Sitemap includes only public non-token routes.

## OWNER_ACTION_REQUIRED

1. Vercel domains:
   - Add `remhaos.com`.
   - Add `www.remhaos.com`.
   - Keep `arhidom.space` and `www.arhidom.space` controlled until redirect coverage is verified.
2. DNS:
   - Point apex `remhaos.com` to Vercel.
   - Point `www.remhaos.com` to Vercel.
3. Vercel env:
   - `NEXT_PUBLIC_APP_URL=https://remhaos.com`
   - `NEXT_PUBLIC_SUPPORT_EMAIL=support@remhaos.com`
4. Supabase Auth:
   - Site URL: `https://remhaos.com`
   - Redirect URLs:
     - `https://remhaos.com/auth/callback`
     - `https://remhaos.com/login`
     - current Vercel preview callback URLs while PR QA runs
5. Email:
   - Verify `remhaos.com` sender domain.
   - Configure sender `noreply@remhaos.com`.
   - Verify SPF, DKIM and DMARC.
6. Search/analytics:
   - Google Search Console domain property for `remhaos.com`.
   - Bing Webmaster Tools.
   - Yandex Webmaster.
   - Submit `https://remhaos.com/sitemap.xml`.
   - Update analytics/tag-manager allowed domains.

## Verification commands after owner actions

```bash
curl -I https://remhaos.com/
curl -I https://www.remhaos.com/
curl -I https://arhidom.space/demo/proposal?x=1
curl -I https://www.arhidom.space/login
curl -s https://remhaos.com/sitemap.xml
curl -s https://remhaos.com/robots.txt
curl -s https://remhaos.com/llms.txt
```

Expected after cutover: apex returns 200; alternate/legacy hosts return one-hop 301 to equivalent `https://remhaos.com` paths.
