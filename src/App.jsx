import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

const FIELDS = [
  ["name", "Full name", "text"],
  ["email", "Work email (used to sign in)", "email"],
  ["department", "Department", "text"],
  ["position", "Job title", "text"],
  ["salary", "Annual salary", "number"],
];
const BLANK = { name: "", email: "", department: "", position: "", salary: "", password: "", role: "employee" };
const SAVED = [...FIELDS.map(([k]) => k), "password", "role"];

// Change "USD" to your currency code (e.g. "INR", "EUR") if needed.
const fmt = (opts) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", ...opts });
const money = (n) => fmt({ maximumFractionDigits: 0 }).format(n);
const compact = (n) => fmt({ notation: "compact", maximumFractionDigits: 1 }).format(n);
const hue = (s) => [...s.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const initials = (name) => name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

async function api(path, options) {
  const { token } = JSON.parse(localStorage.getItem("session") || "{}");
  const res = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { status: res.status });
  return data;
}

function Login({ onLogin }) {
  const [role, setRole] = useState("employee");
  const [mode, setMode] = useState("signin");
  const [creds, setCreds] = useState({ name: "", email: "", password: "" });
  const signup = mode === "signup";
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api(signup ? "/signup" : "/login", { method: "POST", body: JSON.stringify({ ...creds, role }) });
      localStorage.setItem("session", JSON.stringify(session));
      onLogin(session);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  const set = (key) => (e) => setCreds({ ...creds, [key]: e.target.value });

  return (
    <div className="login">
      <form className="panel" onSubmit={submit}>
        <h1>{signup ? "Create your account" : "Welcome back"}</h1>
        <p>
          {signup
            ? role === "admin" ? "Set up the employer account. This only works until the first admin exists." : "Join your team's workspace."
            : role === "admin" ? "Sign in to manage your team." : "Sign in to see your profile and your team."}
        </p>
        <div className="tabs" role="tablist">
          {[["employee", "Employee"], ["admin", "Admin"]].map(([key, label]) => (
            <button
              type="button" role="tab" key={key} aria-selected={role === key} className={role === key ? "on" : ""}
              onClick={() => { setRole(key); setError(""); }}
            >
              {label}
            </button>
          ))}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {signup && <label>Full name<input required autoComplete="name" value={creds.name} onChange={set("name")} /></label>}
        <label>Email<input required type="email" autoComplete="username" value={creds.email} onChange={set("email")} /></label>
        <label>
          Password
          <input required type="password" minLength={signup ? 6 : undefined} autoComplete={signup ? "new-password" : "current-password"} value={creds.password} onChange={set("password")} />
        </label>
        <button className="btn primary" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
        <button type="button" className="link" onClick={() => { setMode(signup ? "signin" : "signup"); setError(""); }}>
          {signup ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ session, onLogout }) {
  const admin = session.user.role === "admin";
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("");
  const [form, setForm] = useState(null); // null = modal closed
  const [error, setError] = useState("");

  const run = async (fn) => {
    try {
      setError("");
      await fn();
    } catch (e) {
      e.status === 401 ? onLogout() : setError(e.message);
    }
  };
  const load = () => run(async () => setList(await api("/employees")));
  useEffect(() => { load().finally(() => setLoading(false)); }, []);

  const depts = [...new Set(list.map((e) => e.department))].sort();
  const filter = depts.includes(dept) ? dept : "";
  const shown = list.filter(
    (e) => (!filter || e.department === filter) && [e.name, e.email, e.position].join(" ").toLowerCase().includes(search.toLowerCase())
  );
  const me = list.find((e) => e._id === session.user._id);

  const open = (emp = BLANK) => { setError(""); setForm({ ...BLANK, ...emp, password: "" }); };
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const save = (ev) => {
    ev.preventDefault();
    run(async () => {
      const body = JSON.stringify(Object.fromEntries(SAVED.map((k) => [k, form[k]])));
      await api(form._id ? `/employees/${form._id}` : "/employees", { method: form._id ? "PUT" : "POST", body });
      setForm(null);
      await load();
    });
  };
  const remove = (emp) =>
    window.confirm(`Delete ${emp.name}? This can't be undone.`) &&
    run(async () => { await api(`/employees/${emp._id}`, { method: "DELETE" }); await load(); });

  const banner = error && <p className="error" role="alert">{error}</p>;

  return (
    <main>
      <header>
        <div>
          <h1>{admin ? "Employees" : `Hi, ${session.user.name.split(" ")[0]}`}</h1>
          <p>{admin ? "Add, find and update the people in your company." : "Your details and the people you work with."}</p>
        </div>
        <div className="top">
          <span className="me">{session.user.name} <b className="badge">{admin ? "Admin" : "Employee"}</b></span>
          <button className="btn" onClick={onLogout}>Log out</button>
          {admin && <button className="btn primary" onClick={() => open()}>Add employee</button>}
        </div>
      </header>

      {admin && (
        <section className="panel stats">
          <div><b>{list.length}</b><span>Employees</span></div>
          <div><b>{depts.length}</b><span>Departments</span></div>
          <div><b>{compact(list.reduce((sum, e) => sum + e.salary, 0))}</b><span>Yearly payroll</span></div>
        </section>
      )}

      {!admin && me && (
        <section className="panel profile" style={{ "--h": hue(me.department) }}>
          <span className="av">{initials(me.name)}</span>
          <div>
            <h2>{me.name}</h2>
            <p>{me.position} in {me.department}</p>
          </div>
          <dl>
            <div><dt>Email</dt><dd>{me.email}</dd></div>
            <div><dt>Yearly salary</dt><dd>{money(me.salary)}</dd></div>
          </dl>
        </section>
      )}

      {!form && banner}
      {!admin && <h2 className="sub">Team directory</h2>}
      <div className="toolbar">
        <input type="search" placeholder="Search by name, email or job title" aria-label="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Filter by department" value={filter} onChange={(e) => setDept(e.target.value)}>
          <option value="">All departments</option>
          {depts.map((d) => <option key={d}>{d}</option>)}
        </select>
      </div>

      <div className="panel">
        {shown.length ? (
          <table>
            <thead>
              <tr>
                <th>Employee</th><th>Department</th><th>Job title</th>
                {admin && <><th>Salary</th><th aria-label="Actions" /></>}
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e._id} style={{ "--h": hue(e.department) }}>
                  <td>
                    <div className="who">
                      <span className="av">{initials(e.name)}</span>
                      <div>{e.name}<small>{e.email}</small></div>
                    </div>
                  </td>
                  <td data-label="Department"><span className="chip">{e.department}</span></td>
                  <td data-label="Job title">{e.position}</td>
                  {admin && (
                    <>
                      <td data-label="Salary">{money(e.salary)}</td>
                      <td className="acts">
                        <button className="btn" onClick={() => open(e)}>Edit</button>
                        <button className="btn danger" disabled={e._id === session.user._id} onClick={() => remove(e)}>Delete</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="empty">
            {loading ? "Loading employees…" : list.length ? "No one matches your search." : "No employees yet. Select Add employee to create the first one."}
          </p>
        )}
      </div>

      {form && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <form className="panel modal" onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="title">
            <h2 id="title">{form._id ? "Edit employee" : "Add employee"}</h2>
            {banner}
            {FIELDS.map(([key, label, type]) => (
              <label key={key}>
                {label}
                <input
                  required
                  autoFocus={key === "name"}
                  type={type}
                  min={type === "number" ? 0 : undefined}
                  list={key === "department" ? "depts" : undefined}
                  value={form[key]}
                  onChange={set(key)}
                />
              </label>
            ))}
            <label>
              {form._id ? "New password (leave blank to keep the current one)" : "Password"}
              <input type="password" autoComplete="new-password" minLength={6} required={!form._id} value={form.password} onChange={set("password")} />
            </label>
            <label>
              Access level
              <select value={form.role} disabled={form._id === session.user._id} onChange={set("role")}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <datalist id="depts">{depts.map((d) => <option key={d} value={d} />)}</datalist>
            <div className="row">
              <button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn primary">{form._id ? "Save changes" : "Add employee"}</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem("session") || "null"));
  const logout = () => {
    localStorage.removeItem("session");
    setSession(null);
  };
  return session ? <Dashboard session={session} onLogout={logout} /> : <Login onLogin={setSession} />;
}

createRoot(document.getElementById("root")).render(<App />);