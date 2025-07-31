# Zarcaro APC Payment Portal

This repository contains a simple, accessible payment portal for
clients of **Zarcaro APC**, a law firm that serves elderly customers.
It is designed to make it easy for clients to log in with an email
account, pay invoices using card or ACH, link a bank account, and
contact the firm.  Transaction history is stored in Google Firestore.

The project is split into two parts:

| Path        | Description                                 |
|-------------|---------------------------------------------|
| `frontend/` | Static client built with React + Tailwind.   |
| `backend/`  | Flask API to handle payments and Plaid flows |

Both services can be deployed separately: the React frontend to
[Vercel](https://vercel.com/) and the Flask backend to
[Render](https://render.com/).  A public GitHub repository named
`zarcaro-pay` should be created and connected to these services for
automatic deploys.

## Features

* **Email authentication** via Firebase Auth (no social logins).
* **Payments** processed through Stripe Checkout with support for card,
  Apple Pay and ACH transfers.
* **Bank linking** via Plaid’s sandbox environment.
* **Invoice and payment history** stored in Firestore and retrievable
  through the API.
* **Contact form** that stores messages in Firestore and optionally
  sends an email to `john@zarcaroapc.com`.
* **Responsive UI** optimised for elderly users with large fonts and
  high contrast colours.

## Local development

You can run both the backend and frontend locally for testing.
Because this repository was prepared in an offline environment you may
need to install dependencies first.

### Backend

1. Create a Python virtual environment:

   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and fill in the required values.
   At minimum you’ll need your Stripe test keys, Plaid sandbox
   credentials, and Firebase service account JSON.  For development
   you can store the service account JSON in the `FIREBASE_SERVICE_ACCOUNT_JSON`
   variable (use a single line; Render supports multi‑line secrets).

3. Start the server:

   ```bash
   python app.py
   ```

   The API will listen on `http://localhost:5000`.  When developing
   the frontend you may need to enable CORS; the backend already uses
   `flask-cors` to allow requests from any origin.

### Frontend

The frontend is a single‑page application written in React but uses
CDNs rather than a local build tool so that it can be served as
static files.  To preview the client locally you can serve it with
any static server or simply open `frontend/index.html` in your browser.

For a simple development server:

```bash
cd frontend
python3 -m http.server 3000
```

Then navigate to `http://localhost:3000`.

Before the app will work you must copy `frontend/firebase_config.js.example` to
`frontend/firebase_config.js` and fill in your Firebase project
configuration.  You will also need to edit `frontend/env.js` (see
below) to set the backend base URL, Stripe publishable key, and Plaid
public key.

## Deployment

### 1. Set up Firebase

1. Create a new Firebase project in the [Firebase console](https://console.firebase.google.com/).
2. Enable **Authentication → Email/Password** provider.
3. Create a **Firestore** database in *production mode*.
4. Under **Service accounts** click *Generate new private key* and
   download the JSON file.  This is your service account.  Either
   encode it to a single line (e.g. with `jq -c .` in a shell) and set
   it in `FIREBASE_SERVICE_ACCOUNT_JSON` or upload the file and set
   `FIREBASE_SERVICE_ACCOUNT_FILE`.
5. Copy your Firebase configuration (API key, Auth domain, Project ID,
   etc.) from **Project settings → General**.  You’ll need these for
   the frontend.

### 2. Create the GitHub repository

1. Log in to GitHub and create a public repository named
   `zarcaro-pay`.
2. Push the contents of this directory to the repository.  A typical
   workflow might be:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your‑user>/zarcaro-pay.git
   git push -u origin main
   ```

### 3. Deploy the backend to Render

1. Sign in to [Render](https://render.com/) and click **New → Web Service**.
2. Choose **Public Git Repository** and select `zarcaro-pay`.
3. Under *Environment* pick **Python** and set the start command to:

   ```
   gunicorn --bind 0.0.0.0:$PORT app:create_app()
   ```

4. Add the environment variables from `backend/.env.example` into the
   Render *Environment* tab.  Make sure to include all Firebase,
   Stripe and Plaid credentials.
5. Save and deploy.  Render will build the image and host your API at
   a URL like `https://zarcaro-pay-backend.onrender.com`.

### 4. Deploy the frontend to Vercel

1. Sign in to [Vercel](https://vercel.com/) and import the
   `zarcaro-pay` repository.
2. During setup choose **Other** as the framework since the project
   contains static files.
3. Set the build output directory to `frontend`.
4. Configure the following environment variables (preface each with
   `VITE_` or `NEXT_PUBLIC_` depending on your preference for
   consumption in client code):

   * `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` – your Stripe publishable key
   * `NEXT_PUBLIC_BACKEND_URL` – the URL of your Render backend
   * `NEXT_PUBLIC_PLAID_ENV` – `sandbox`
   * `NEXT_PUBLIC_PLAID_PUBLIC_KEY` – **not required** for the new Plaid
     Link token flow but you may leave it blank
   * `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
     `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, etc. – your Firebase client config

5. Deploy the project.  Vercel will serve your static files and
   provide a URL like `https://zarcaro-pay.vercel.app`.

## Firebase login instructions

Once deployed, your clients can follow these steps to log in and
submit a payment:

1. Navigate to the frontend URL (e.g. `https://zarcaro-pay.vercel.app`).
2. Click **Sign up / Log in** and enter their email address and a
   password.  The first time they do this an account will be created.
3. After logging in, they will see their payment dashboard.  They
   can click **Make a Payment** to specify an amount (in dollars)
   and proceed through Stripe Checkout.
4. To link a bank account they can click **Link Bank** and follow
   the Plaid sandbox instructions.  For testing use the credentials
   `user_good` / `pass_good`.
5. Transaction history will display all past payments.  The **Contact
   Us** page allows them to send a message to the firm.

## Security notes

* Never commit real secrets or private keys to source control.  Use
  environment variables and secret managers provided by your hosting
  platform.
* In production enable Stripe webhooks to record payments automatically
  and verify signatures using `STRIPE_WEBHOOK_SECRET`.
* Restrict Firestore rules to allow each user to access only their own
  documents.  Firebase’s security rules should be configured
  accordingly.

## Disclaimer

This codebase was assembled in an offline environment, so the
dependencies have not been installed or tested here.  You may need to
adjust the versions specified in `requirements.txt` or tweak the
frontend scripts to suit your hosting configuration.  Use this as a
starting point for building a polished payment portal tailored to your
clients.