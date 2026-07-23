grant select on public.account_directory to service_role;

-- The username-auth Edge Function only needs to resolve a username to the
-- account email. Browser roles remain fully revoked from this private mapping.
