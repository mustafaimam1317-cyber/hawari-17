# HAWARI INFECTION — PHASE 3A AUDIT REPORT

## 1. Supabase Initialization
- **Configured Endpoints:**
  - `VITE_SUPABASE_URL`: `https://sueksolsletlhunpbtix.supabase.co`
  - `VITE_SUPABASE_ANON_KEY`: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- **Request Wrapper:** All database queries invoke `supabaseRequest(path, options)` in `app.js` using REST API endpoints over PostgREST with standard `apikey` and `Authorization: Bearer [token]` headers.

---

## 2. Authentication Flow
- **Current Mechanism:**
  1. User submits email address -> `app.js` checks `state.users` (cached locally or queried via `hawari_users?email=eq.${email}`).
  2. If account status is `approved`, prompts for password -> hashes password with SHA-256 (`sha256Sync(password)`) -> matches hash against `user.password_hash`.
  3. On success, sets `state.currentUser = user` in memory and persists encrypted state in `localStorage` under `hawari_user_session_${group}`.
- **Supabase Auth Integration Strategy:**
  - Enhance login/registration to invoke Supabase Auth (`supabase.auth.signInWithPassword` & `supabase.auth.signUp`), attaching the JWT token to `state.currentUser.token` so PostgREST RLS policy checks evaluate `auth.jwt() ->> 'email'`.

---

## 3. User Registration Flow
- **Current Process:**
  1. Unregistered user enters email and sets password in registration step (`#btn-register-submit`).
  2. Front-end constructs `newUser = { email, password_hash, role: 'user', status: 'pending', dateRegistered }`.
  3. Invokes `supabaseRequest("hawari_users", { method: "POST", ... })`.
- **RLS Policy Compatibility Note:**
  - Registration takes place **before** a user session token exists.
  - RLS policy on `hawari_users` MUST allow `INSERT` for new registration requests if `role = 'user'` and `status = 'pending'`, preventing unauthorized self-elevation to `admin` or `approved`.

---

## 4. Admin Authentication
- **Role Detection:** `user.role === 'admin'` and `user.email === 'mustafaimam1317@gmail.com'`.
- **Database Status:** `role = 'admin'`, `status = 'approved'`.
- **Hardened Verification:** Evaluated server-side via SQL function `public.is_admin()`.

---

## 5. Book System & Storage Flow
- **Upload (`processBookPdfUpload`):**
  - Uploads PDF to Supabase Storage bucket `hawari_books`.
  - Generates relative storage path `{group_name}/{book_id}.pdf`.
  - Writes record to `hawari_book_files`.
- **Reader Engine (`openBook`):**
  - Invokes `getSignedBookUrl(filePath, 300)` via Supabase Storage API (`/storage/v1/object/sign/hawari_books/{path}`).
  - Passes short-lived signed URL to PDF.js canvas renderer.

---

## 6. Student-Owned Data
- `hawari_book_annotations`: Scoped by `email`, `document_id`, `page_number`.
- `hawari_user_book_progress`: Scoped by `email`, `book_id`.
- `personal_flashcards`: Scoped by `authorEmail`, `group_name`.
- `hawari_quiz_results`: Scoped by `email`, `quiz_id`.

---

## 7. Question Bank (`hawari_global_questions`)
- Read access open to authenticated students (`auth.role() = 'authenticated'`).
- Modifications (`INSERT`/`UPDATE`/`DELETE`) restricted exclusively to Admins (`is_admin()`).

---

## 8. Logout & Session Handling
- Logout triggers `supabase.auth.signOut()`, clears `state.currentUser`, resets local storage tokens, and redirects to landing page.
