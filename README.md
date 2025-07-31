# Frontend

The `frontend` directory contains the client portion of the Zarcaro APC
payment portal.  It is a static single‑page application built with
React and Tailwind CSS.  The code is intentionally simple and does
not rely on a bundler; instead it uses UMD builds of React and
Firebase that are loaded directly from CDNs.

## Configuration

Before you can run or deploy the frontend you must provide two
configuration files:

* `env.js` – defines runtime variables such as the backend base URL
  and your Stripe publishable key.
* `firebase_config.js` – contains your Firebase project settings.

Example files are provided:

* `env.js` – copy this file and fill in the values for `BACKEND_URL`
  and `STRIPE_PUBLISHABLE_KEY`.
* `firebase_config.js.example` – copy this file to
  `firebase_config.js` and populate it with your Firebase web app
  config (found under **Project settings → General** in the Firebase
  console).

These files are deliberately excluded from version control because
they contain sensitive information.

## Running locally

To test the frontend locally without deploying you can serve the files
with any HTTP server.  For example:

```bash
cd frontend
cp firebase_config.js.example firebase_config.js
cp env.js env.js
# edit env.js and firebase_config.js to add your values
python3 -m http.server 3000
```

Then open `http://localhost:3000/` in your browser.  Make sure the
backend is running (see `../backend/README.md`) and that
`env.js` points to it via `BACKEND_URL`.

## Deployment

For deployment on Vercel (or any static hosting provider), ensure that
`env.js` and `firebase_config.js` are created at build time using
environment variables.  On Vercel you can prefix variables with
`NEXT_PUBLIC_` and then generate `env.js` using a simple script or
post‑install hook.  See the repository root `README.md` for
deployment details.