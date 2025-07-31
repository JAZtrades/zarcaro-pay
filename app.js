// Zarcaro APC frontend application
//
// This script implements a simple React application using UMD builds of
// React and Firebase loaded from CDNs.  It provides email login,
// payment checkout via Stripe, bank linking via Plaid, a contact form
// and a transaction history view.  Before using this app you must
// supply configuration values in `env.js` and `firebase_config.js`.

(function () {
  const { useState, useEffect } = React;

  // Guard against missing configuration
  if (!window.ENV_CONFIG || !window.FIREBASE_CONFIG) {
    document.getElementById("root").textContent =
      "Configuration missing.  Please fill in env.js and firebase_config.js.";
    return;
  }

  // Initialise Firebase
  firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const firestore = firebase.firestore();

  /**
   * Acquire a Stripe instance.  We lazily create the instance on first
   * use to avoid errors if the publishable key has not been provided.
   */
  let stripeInstance = null;
  function getStripe() {
    if (!stripeInstance) {
      const key = window.ENV_CONFIG.STRIPE_PUBLISHABLE_KEY;
      if (!key) {
        throw new Error(
          "Missing STRIPE_PUBLISHABLE_KEY in env.js.  Please provide your publishable key."
        );
      }
      stripeInstance = Stripe(key);
    }
    return stripeInstance;
  }

  /**
   * Top‑level component that manages authentication state and routing.
   */
  function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      const unsubscribe = auth.onAuthStateChanged((u) => {
        setUser(u);
        setLoading(false);
      });
      return () => unsubscribe();
    }, []);

    if (loading) {
      return (
        <div className="flex justify-center items-center h-screen text-xl">
          Loading...
        </div>
      );
    }
    if (!user) {
      return <LoginForm />;
    }
    return <Dashboard user={user} />;
  }

  /**
   * Login form component.  Attempts to sign in with the provided
   * credentials.  If the account does not exist it will be created
   * automatically.  Passwords must be at least six characters as per
   * Firebase’s requirements.
   */
  function LoginForm() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [processing, setProcessing] = useState(false);

    const handleSubmit = async (e) => {
      e.preventDefault();
      setProcessing(true);
      setError("");
      try {
        await auth.signInWithEmailAndPassword(email, password);
      } catch (err) {
        // If the user doesn’t exist create a new account
        if (err.code === "auth/user-not-found") {
          try {
            await auth.createUserWithEmailAndPassword(email, password);
          } catch (createErr) {
            setError(createErr.message);
          }
        } else {
          setError(err.message);
        }
      } finally {
        setProcessing(false);
      }
    };

    return (
      <div className="bg-white rounded shadow p-6 mx-auto mt-20 max-w-md">
        <h2 className="text-2xl font-bold mb-4 text-center">Client Login</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-700 mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              className="w-full border border-gray-300 rounded p-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-1" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              className="w-full border border-gray-300 rounded p-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded disabled:opacity-50"
            disabled={processing}
          >
            {processing ? "Please wait…" : "Sign In / Register"}
          </button>
        </form>
      </div>
    );
  }

  /**
   * Dashboard component shown when the user is authenticated.  Provides
   * navigation among four tabs: payments, bank linking, history and
   * contact.  Displays the user’s email and a sign‑out button.
   */
  function Dashboard({ user }) {
    const [activeTab, setActiveTab] = useState("payments");

    return (
      <div className="mt-10">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-bold mb-2">Zarcaro APC Portal</h1>
          <p className="text-gray-600">Welcome, {user.email}</p>
          <button
            className="mt-2 text-sm text-blue-600 underline"
            onClick={() => auth.signOut()}
          >
            Sign out
          </button>
        </header>
        <nav className="flex justify-center space-x-2 mb-4">
          <TabButton
            active={activeTab === "payments"}
            onClick={() => setActiveTab("payments")}
          >
            Pay Invoice
          </TabButton>
          <TabButton
            active={activeTab === "bank"}
            onClick={() => setActiveTab("bank")}
          >
            Link Bank
          </TabButton>
          <TabButton
            active={activeTab === "history"}
            onClick={() => setActiveTab("history")}
          >
            History
          </TabButton>
          <TabButton
            active={activeTab === "contact"}
            onClick={() => setActiveTab("contact")}
          >
            Contact
          </TabButton>
        </nav>
        <main>
          {activeTab === "payments" && <PaymentSection user={user} />}
          {activeTab === "bank" && <BankSection user={user} />}
          {activeTab === "history" && <HistorySection user={user} />}
          {activeTab === "contact" && <ContactSection />}
        </main>
        <footer className="mt-8 text-center text-sm text-gray-500">
          <a href="https://zarcaro.com" className="underline" target="_blank">
            www.zarcaro.com
          </a>
        </footer>
      </div>
    );
  }

  function TabButton({ active, children, onClick }) {
    return (
      <button
        className={
          "px-3 py-1 rounded " +
          (active ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300")
        }
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  /**
   * Payment section.  Allows the user to enter an amount and trigger
   * a Stripe Checkout session through the backend.  Amounts are in
   * dollars and converted to cents on submission.
   */
  function PaymentSection({ user }) {
    const [amount, setAmount] = useState("");
    const [status, setStatus] = useState("");
    const [processing, setProcessing] = useState(false);

    const handleCheckout = async () => {
      setProcessing(true);
      setStatus("");
      const cents = Math.round(parseFloat(amount || "0") * 100);
      if (!cents) {
        setStatus("Please enter a valid amount.");
        setProcessing(false);
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const response = await fetch(
          `${window.ENV_CONFIG.BACKEND_URL}/create-checkout-session`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              amount: cents,
              description: `Invoice Payment ($${amount})`,
              success_url: window.location.href,
              cancel_url: window.location.href,
            }),
          }
        );
        const data = await response.json();
        if (data.url) {
          // Redirect to Stripe Checkout
          window.location.href = data.url;
        } else {
          throw new Error(data.error || "Failed to create checkout session");
        }
      } catch (err) {
        console.error(err);
        setStatus(err.message || "An error occurred");
      } finally {
        setProcessing(false);
      }
    };

    return (
      <div className="bg-white shadow rounded p-6">
        <h2 className="text-xl font-semibold mb-4">Make a Payment</h2>
        <div className="flex flex-col space-y-3">
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Amount in USD"
            className="border border-gray-300 rounded p-2"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          {status && <p className="text-red-500 text-sm">{status}</p>}
          <button
            onClick={handleCheckout}
            className="bg-green-600 text-white rounded py-2 disabled:opacity-50"
            disabled={processing}
          >
            {processing ? "Processing..." : "Pay Now"}
          </button>
        </div>
      </div>
    );
  }

  /**
   * Bank linking section.  Calls the backend to create a Plaid link
   * token and then opens Plaid Link.  Upon successful linking the
   * public token is exchanged on the backend.
   */
  function BankSection({ user }) {
    const [status, setStatus] = useState("");
    const [linking, setLinking] = useState(false);

    const startLinkFlow = async () => {
      setLinking(true);
      setStatus("");
      try {
        const idToken = await user.getIdToken();
        const resp = await fetch(
          `${window.ENV_CONFIG.BACKEND_URL}/plaid/create_link_token`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        const handler = window.Plaid.create({
          token: data.link_token,
          onSuccess: async function (public_token, metadata) {
            // Exchange the public token
            try {
              const exchangeResp = await fetch(
                `${window.ENV_CONFIG.BACKEND_URL}/plaid/exchange_public_token`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`,
                  },
                  body: JSON.stringify({ public_token }),
                }
              );
              const exchangeData = await exchangeResp.json();
              if (exchangeData.error) throw new Error(exchangeData.error);
              setStatus("Bank account linked successfully.");
            } catch (err) {
              setStatus(err.message || "Failed to link bank");
            }
          },
          onExit: function (err) {
            if (err) {
              setStatus(err.error_message || "Link exited");
            }
          },
        });
        handler.open();
      } catch (err) {
        console.error(err);
        setStatus(err.message || "Could not start bank linking");
      } finally {
        setLinking(false);
      }
    };

    return (
      <div className="bg-white shadow rounded p-6">
        <h2 className="text-xl font-semibold mb-4">Link Your Bank</h2>
        <p className="mb-4">
          You can securely link your bank account using Plaid.  For testing
          use the credentials <code>user_good</code> / <code>pass_good</code>.
        </p>
        {status && <p className="text-green-600 mb-2">{status}</p>}
        <button
          onClick={startLinkFlow}
          className="bg-purple-600 text-white rounded py-2 px-4 disabled:opacity-50"
          disabled={linking}
        >
          {linking ? "Linking..." : "Link Bank"}
        </button>
      </div>
    );
  }

  /**
   * Transaction history section.  Fetches transactions from the backend
   * and displays them in a table.  Only the most recent 20 items are
   * shown.
   */
  function HistorySection({ user }) {
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const fetchTransactions = async () => {
      setLoading(true);
      setError("");
      try {
        const idToken = await user.getIdToken();
        const resp = await fetch(
          `${window.ENV_CONFIG.BACKEND_URL}/transactions`,
          {
            headers: {
              Authorization: `Bearer ${idToken}`,
            },
          }
        );
        const data = await resp.json();
        if (Array.isArray(data)) {
          setTransactions(data);
        } else {
          throw new Error(data.error || "Failed to fetch transactions");
        }
      } catch (err) {
        setError(err.message || "Unable to load history");
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      fetchTransactions();
    }, []);

    return (
      <div className="bg-white shadow rounded p-6">
        <h2 className="text-xl font-semibold mb-4">Payment History</h2>
        {loading && <p>Loading…</p>}
        {error && <p className="text-red-500">{error}</p>}
        {transactions.length === 0 && !loading && (
          <p>No transactions found.</p>
        )}
        {transactions.length > 0 && (
          <table className="w-full text-left border">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 border">Date</th>
                <th className="p-2 border">Amount</th>
                <th className="p-2 border">Status</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="p-2 border">
                    {tx.timestamp && tx.timestamp.seconds
                      ? new Date(tx.timestamp.seconds * 1000).toLocaleDateString()
                      : "–"}
                  </td>
                    <td className="p-2 border">
                      ${(tx.amount / 100).toFixed(2)} {tx.currency?.toUpperCase() || "USD"}
                    </td>
                    <td className="p-2 border capitalize">{tx.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button
          onClick={fetchTransactions}
          className="mt-4 bg-blue-600 text-white py-2 px-4 rounded"
        >
          Refresh
        </button>
      </div>
    );
  }

  /**
   * Contact form section.  Collects a name, email address and message
   * and posts them to the backend.  Success or error messages are
   * displayed to the user.
   */
  function ContactSection() {
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [status, setStatus] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e) => {
      e.preventDefault();
      setStatus("");
      setSubmitting(true);
      try {
        const resp = await fetch(
          `${window.ENV_CONFIG.BACKEND_URL}/contact`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, message }),
          }
        );
        const data = await resp.json();
        if (data.error) throw new Error(data.error);
        setStatus("Your message has been sent.");
        setName("");
        setEmail("");
        setMessage("");
      } catch (err) {
        setStatus(err.message || "Failed to send message");
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="bg-white shadow rounded p-6">
        <h2 className="text-xl font-semibold mb-4">Contact Us</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-gray-700 mb-1" htmlFor="name">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              className="w-full border border-gray-300 rounded p-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-1" htmlFor="email">
              Email
            </label>
            <input
              id="contact-email"
              type="email"
              required
              className="w-full border border-gray-300 rounded p-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-gray-700 mb-1" htmlFor="message">
              Message
            </label>
            <textarea
              id="message"
              required
              rows="4"
              className="w-full border border-gray-300 rounded p-2"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            ></textarea>
          </div>
          {status && <p className="text-green-600 text-sm">{status}</p>}
          <button
            type="submit"
            className="bg-blue-600 text-white py-2 px-4 rounded disabled:opacity-50"
            disabled={submitting}
          >
            {submitting ? "Sending…" : "Send Message"}
          </button>
        </form>
      </div>
    );
  }

  // Render the application
  ReactDOM.render(<App />, document.getElementById("root"));
})();