"""
Flask application for Zarcaro APC payment portal.

This backend exposes endpoints to handle the following functionality:
  * Stripe Checkout session creation for card, wallet and ACH payments.
  * Plaid sandbox link token generation and public token exchange.
  * Contact form submission via email (optional; see CONTACT_EMAIL and SMTP variables).
  * Retrieval of invoice and payment history from Firestore.

The application assumes that appropriate environment variables are set.  See
``.env.example`` for a list of the required variables.  When deploying to
Render the environment variables can be configured directly in the service
settings.  For local development you can supply a ``.env`` file.

Because the agent environment cannot access external networks, this code has not
been executed here.  It is provided as a complete reference implementation for
deployment in a network‑connected environment.
"""

import os
import json
from typing import Any, Dict

from flask import Flask, request, jsonify
from flask_cors import CORS

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    # ``dotenv`` is optional.  In production Render will provide env vars.
    pass

# Third‑party SDKs.  These imports will fail in the current environment
# because the necessary packages are not installed, but they are left here
# so that the file is ready for deployment.  See ``requirements.txt``.
try:
    import stripe  # type: ignore
    import plaid  # type: ignore
    from plaid.api import plaid_api  # type: ignore
    from plaid.model.link_token_create_request import LinkTokenCreateRequest  # type: ignore
    from plaid.model.link_token_create_request_user import (  # type: ignore
        LinkTokenCreateRequestUser,
    )
    from plaid.model.products import Products  # type: ignore
    from plaid.model.country_code import CountryCode  # type: ignore
    from plaid.model.item_public_token_exchange_request import (  # type: ignore
        ItemPublicTokenExchangeRequest,
    )
    from firebase_admin import credentials, firestore, initialize_app  # type: ignore
except ImportError:
    # The backend cannot run without these dependencies.  They will be
    # installed in the deployment environment.  The try/except allows
    # generation of this file even if the packages are missing locally.
    stripe = None  # type: ignore
    plaid = None  # type: ignore
    plaid_api = None  # type: ignore
    LinkTokenCreateRequest = None  # type: ignore
    LinkTokenCreateRequestUser = None  # type: ignore
    Products = None  # type: ignore
    CountryCode = None  # type: ignore
    ItemPublicTokenExchangeRequest = None  # type: ignore
    credentials = None  # type: ignore
    firestore = None  # type: ignore
    initialize_app = None  # type: ignore


def create_app() -> Flask:
    """Factory to create and configure the Flask app.

    Use this pattern so that the app can be imported without executing side
    effects (useful for testing).
    """
    app = Flask(__name__)
    CORS(app)

    # ----- Stripe configuration -----
    stripe_secret_key = os.getenv("STRIPE_SECRET_KEY")
    stripe_publishable_key = os.getenv("STRIPE_PUBLISHABLE_KEY")
    if stripe and stripe_secret_key:
        stripe.api_key = stripe_secret_key

    # ----- Plaid configuration -----
    plaid_client: Any = None
    if plaid:
        plaid_env = os.getenv("PLAID_ENV", "sandbox").lower()
        if plaid_env not in {"sandbox", "development", "production"}:
            raise ValueError("PLAID_ENV must be one of sandbox, development, production")
        host = {
            "sandbox": plaid.Environment.Sandbox,
            "development": plaid.Environment.Development,
            "production": plaid.Environment.Production,
        }[plaid_env]
        config = plaid.Configuration(
            host=host,
            api_key={
                "clientId": os.getenv("PLAID_CLIENT_ID"),
                "secret": os.getenv("PLAID_SECRET"),
            },
        )
        plaid_client = plaid_api.PlaidApi(plaid.ApiClient(config))

    # ----- Firebase configuration -----
    db = None
    if credentials:
        # Firestore requires a service account.  The JSON string can be
        # supplied either via a path or as an environment variable.  Render
        # supports multi‑line environment variables which we read here.
        firebase_credentials_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
        if firebase_credentials_json:
            creds_dict = json.loads(firebase_credentials_json)
            cred = credentials.Certificate(creds_dict)
        else:
            # Attempt to load from a file specified by FIREBASE_SERVICE_ACCOUNT_FILE
            firebase_key_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_FILE")
            if firebase_key_path and os.path.exists(firebase_key_path):
                cred = credentials.Certificate(firebase_key_path)
            else:
                raise RuntimeError(
                    "Firebase service account credentials not provided."
                )
        initialize_app(cred)
        db = firestore.client()

    # Helper to verify Firebase ID tokens on protected routes.  Client code
    # should include the ID token in the Authorization header as
    # ``Bearer <id_token>``.
    def _verify_firebase_id_token() -> str:
        from firebase_admin import auth  # type: ignore
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise ValueError("Missing Authorization header")
        id_token = auth_header.split(" ")[1]
        decoded = auth.verify_id_token(id_token)
        return decoded["uid"]

    # ----- Routes -----

    @app.route("/health", methods=["GET"])
    def health() -> Dict[str, str]:
        """Simple health check endpoint."""
        return {"status": "ok"}

    @app.route("/create-checkout-session", methods=["POST"])
    def create_checkout_session():
        """Create a Stripe Checkout session.

        Expects a JSON payload with:
          ``amount``: integer, total charge in cents (e.g. 5000 for $50)
          ``description``: string description shown in Stripe checkout (optional)
          ``success_url``: URL to redirect on successful payment
          ``cancel_url``: URL to redirect if the user cancels
        The user's email address will be pulled from the Firebase ID token
        included in the Authorization header.
        """
        if stripe is None:
            return jsonify({"error": "Stripe SDK not installed"}), 500
        data = request.get_json() or {}
        amount = int(data.get("amount", 0))
        description = data.get("description", "Legal Services Payment")
        success_url = data.get("success_url")
        cancel_url = data.get("cancel_url")
        if not all([amount, success_url, cancel_url]):
            return jsonify({"error": "amount, success_url and cancel_url are required"}), 400
        try:
            uid = _verify_firebase_id_token()
            # Retrieve user email from Firestore (optional).  Clients could also
            # send ``customer_email`` directly.
            customer_email = None
            if db:
                doc = db.collection("users").document(uid).get()
                if doc.exists:
                    customer_email = doc.to_dict().get("email")
            session = stripe.checkout.Session.create(
                payment_method_types=["card", "us_bank_account"],
                line_items=[
                    {
                        "price_data": {
                            "currency": "usd",
                            "unit_amount": amount,
                            "product_data": {"name": description},
                        },
                        "quantity": 1,
                    }
                ],
                mode="payment",
                customer_email=customer_email,
                success_url=success_url,
                cancel_url=cancel_url,
            )
            return jsonify({"url": session.url})
        except Exception as exc:  # pylint: disable=broad-except
            return jsonify({"error": str(exc)}), 400

    @app.route("/stripe/webhook", methods=["POST"])
    def stripe_webhook():
        """Handle Stripe webhook events.

        This endpoint records successful payments in Firestore.  Configure the
        webhook endpoint in your Stripe dashboard to point to
        ``<backend-url>/stripe/webhook``.  When testing locally you can use
        Stripe CLI to forward events to your local server.
        """
        if stripe is None or db is None:
            return "", 500
        payload = request.data
        sig_header = request.headers.get("Stripe-Signature")
        webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET")
        event = None
        try:
            if webhook_secret:
                event = stripe.Webhook.construct_event(
                    payload, sig_header, webhook_secret
                )
            else:
                event = stripe.Event.construct_from(
                    json.loads(payload), stripe.api_key
                )
        except Exception:
            return "", 400
        # Handle the event
        if event["type"] == "checkout.session.completed":
            session = event["data"]["object"]
            uid = session.get("client_reference_id")
            if not uid:
                uid = "unknown"
            # Save transaction in Firestore
            db.collection("users").document(uid).collection("transactions").add(
                {
                    "amount": session["amount_total"],
                    "currency": session["currency"],
                    "payment_intent": session.get("payment_intent"),
                    "status": session["payment_status"],
                    "timestamp": firestore.SERVER_TIMESTAMP,
                }
            )
        # Return 200 to acknowledge receipt of the event
        return "", 200

    @app.route("/plaid/create_link_token", methods=["POST"])
    def plaid_create_link_token():
        """Generate a Plaid link token for the current user."""
        if plaid_client is None:
            return jsonify({"error": "Plaid SDK not installed"}), 500
        try:
            uid = _verify_firebase_id_token()
        except Exception as exc:
            return jsonify({"error": str(exc)}), 401
        # Create the link token
        request_body = LinkTokenCreateRequest(
            user=LinkTokenCreateRequestUser(client_user_id=uid),
            client_name="Zarcaro APC",
            products=[Products("auth")],
            country_codes=[CountryCode("US")],
            language="en",
        )
        try:
            response = plaid_client.link_token_create(request_body)
            return jsonify(response.to_dict())
        except Exception as exc:
            return jsonify({"error": str(exc)}), 400

    @app.route("/plaid/exchange_public_token", methods=["POST"])
    def plaid_exchange_public_token():
        """Exchange a public token for an access token and store it in Firestore."""
        if plaid_client is None or db is None:
            return jsonify({"error": "Plaid or Firestore not configured"}), 500
        data = request.get_json() or {}
        public_token = data.get("public_token")
        if not public_token:
            return jsonify({"error": "public_token is required"}), 400
        try:
            uid = _verify_firebase_id_token()
        except Exception as exc:
            return jsonify({"error": str(exc)}), 401
        exchange_request = ItemPublicTokenExchangeRequest(public_token=public_token)
        try:
            exchange_response = plaid_client.item_public_token_exchange(
                exchange_request
            )
            access_token = exchange_response["access_token"]
            # Store the access token in Firestore under the user document
            db.collection("users").document(uid).set(
                {"plaidAccessToken": access_token}, merge=True
            )
            return jsonify({"message": "Bank account linked"})
        except Exception as exc:
            return jsonify({"error": str(exc)}), 400

    @app.route("/contact", methods=["POST"])
    def submit_contact_form():
        """Handle contact form submissions.

        Expects JSON payload with ``name``, ``email`` and ``message`` fields.
        Attempts to send an email via SMTP if CONTACT_EMAIL and SMTP_* env vars
        are configured.  Regardless of whether email sending succeeds, the
        message is stored in Firestore for later retrieval.
        """
        data = request.get_json() or {}
        name = data.get("name")
        email = data.get("email")
        message = data.get("message")
        if not all([name, email, message]):
            return jsonify({"error": "name, email and message are required"}), 400
        # Save message to Firestore
        if db:
            db.collection("contact_messages").add(
                {
                    "name": name,
                    "email": email,
                    "message": message,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                }
            )
        # Attempt to send email
        contact_email = os.getenv("CONTACT_EMAIL")
        smtp_host = os.getenv("SMTP_HOST")
        smtp_port = os.getenv("SMTP_PORT")
        smtp_user = os.getenv("SMTP_USER")
        smtp_password = os.getenv("SMTP_PASSWORD")
        if contact_email and smtp_host and smtp_port and smtp_user and smtp_password:
            try:
                import smtplib
                from email.mime.text import MIMEText

                body = f"Message from {name} <{email}>:\n\n{message}"
                msg = MIMEText(body)
                msg["Subject"] = "New contact form submission"
                msg["From"] = smtp_user
                msg["To"] = contact_email
                with smtplib.SMTP(smtp_host, int(smtp_port)) as server:
                    server.starttls()
                    server.login(smtp_user, smtp_password)
                    server.send_message(msg)
            except Exception as exc:
                # Log but do not fail the request
                print(f"Failed to send contact email: {exc}")
        return jsonify({"message": "Contact form submitted"})

    @app.route("/transactions", methods=["GET"])
    def list_transactions():
        """Return a list of past transactions for the authenticated user."""
        if db is None:
            return jsonify({"error": "Firestore not configured"}), 500
        try:
            uid = _verify_firebase_id_token()
        except Exception as exc:
            return jsonify({"error": str(exc)}), 401
        docs = (
            db.collection("users")
            .document(uid)
            .collection("transactions")
            .order_by("timestamp", direction=firestore.Query.DESCENDING)
            .stream()
        )
        results = []
        for doc in docs:
            data = doc.to_dict()
            data["id"] = doc.id
            results.append(data)
        return jsonify(results)

    return app


if __name__ == "__main__":
    # Only run if executed directly.  When deployed on Render the platform
    # executes ``gunicorn app:app`` which imports create_app() implicitly.
    flask_app = create_app()
    flask_app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=True)