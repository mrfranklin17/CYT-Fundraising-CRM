-- Organization branding.
--
-- The logo belongs on the org row, not in the markup. This app is multi-tenant
-- from the first migration, and a hardcoded logo would put one organization's
-- mark on another organization's board the moment a second row appears in
-- `orgs`.
--
-- `logo_url` is a path served by the app (public/) or an absolute URL. The
-- masthead is dark in both light and dark mode, so the file it points at should
-- be a reversed / light-on-transparent version. `logo_alt` is what a screen
-- reader announces in its place.
--
-- A note on rights, carried over from CLAUDE.md: the CYT mark is trademarked by
-- CYT National and Spokane is a licensed affiliate. The file referenced here was
-- supplied by the organization for its own use. Do not recreate, redraw or
-- restyle the mark — point at the file they give you, or fall back to the
-- wordmark.

alter table public.orgs
  add column if not exists logo_url text,
  add column if not exists logo_alt text;

comment on column public.orgs.logo_url is
  'Path or URL to a reversed (light-on-transparent) logo for the dark masthead. Null falls back to the Grantboard wordmark.';
comment on column public.orgs.logo_alt is
  'Alt text for logo_url. Null falls back to the organization name.';

update public.orgs
set logo_url = '/orgs/cyt-spokane.webp',
    logo_alt = 'CYT Spokane'
where slug = 'cyt-spokane';
