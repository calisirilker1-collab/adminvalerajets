# Valera Jets Admin

Secure static admin dashboard for `admin.valerajets.com`, backed by Supabase Auth + RLS.

## 1. Create the admin user
In Supabase: **Authentication → Users → Add user → Create new user**. Create the email/password account you will use to log in.

## 2. Run the security SQL
Open `setup-admin.sql`. Replace `YOUR_ADMIN_EMAIL` in the final SQL statement with the email you just created, then run the entire file in **Supabase → SQL Editor**.

This creates an `admin_users` allow-list and policies that let only allow-listed authenticated users read/update `flight_requests`.

## 3. Create a separate GitHub repository
Recommended repo name: `valerajets-admin`.
Upload the files in this folder to the repository root.

GitHub → repository **Settings → Pages**:
- Source: Deploy from a branch
- Branch: `main`
- Folder: `/ (root)`
- Custom domain: `admin.valerajets.com`

## 4. IONOS DNS
Add a CNAME record:
- Type: CNAME
- Host: `admin`
- Points to: `calisirilker1-collab.github.io`

Do not change the existing `@`, `www`, MX, SPF, DKIM or `_domainconnect` records.

## 5. HTTPS
When GitHub's DNS check succeeds, enable **Enforce HTTPS** in Settings → Pages.

## Security notes
- `config.js` contains only the Supabase publishable browser key. This is expected for a browser application.
- Never add a `service_role` key or `sb_secret_...` key to GitHub/browser files.
- Database privacy is enforced by Supabase RLS, not by hiding the JavaScript.
- `robots.txt` and `noindex` keep the admin UI out of search engines, but authentication + RLS are the actual security controls.
