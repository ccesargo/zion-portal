import { useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE CONFIG
// Substitua pelos valores do seu projeto Firebase
// ─────────────────────────────────────────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE SDK — carregado dinamicamente via CDN
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import {
  getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc,
  onSnapshot, query, where, orderBy, serverTimestamp,
} from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL } from "firebase/storage";

let firebaseApp, auth, db, storage, fbFunctions;

async function loadFirebase() {
  if (firebaseApp) return;
  firebaseApp = initializeApp(FIREBASE_CONFIG);
  auth = { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, instance: getAuth(firebaseApp) };
  db = {
    getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc,
    onSnapshot, query, where, orderBy, serverTimestamp, instance: getFirestore(firebaseApp),
  };
  storage = { getStorage, ref, uploadBytes, getDownloadURL, instance: getStorage(firebaseApp) };
  fbFunctions = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRESTORE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
// Estrutura das coleções:
//   /users/{uid}           → { name, email, role, caseType, sponsor, priorityDate, clientId,
//                              protocols: [{id, label, number, url}] }
//   /messages/{id}         → { clientId, from, subject, body, date, source, read }
//   /payments/{id}         → { clientId, description, amount, date, status, receiptUrl }
//   /caseStatus/{clientId} → { stages: [{id, stage, status, date, note}] }
//   /bulletin/current      → { month, updated, eb3, eb3Unskilled }

async function firestoreGet(col, id) {
  const snap = await db.getDoc(db.doc(db.instance, col, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function firestoreAdd(col, data) {
  const ref = await db.addDoc(db.collection(db.instance, col), {
    ...data,
    createdAt: db.serverTimestamp(),
  });
  return ref.id;
}

async function firestoreUpdate(col, id, data) {
  await db.updateDoc(db.doc(db.instance, col, id), {
    ...data,
    updatedAt: db.serverTimestamp(),
  });
}

async function firestoreList(col, ...constraints) {
  const q = constraints.length
    ? db.query(db.collection(db.instance, col), ...constraints)
    : db.collection(db.instance, col);
  const snap = await db.getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function firestoreListen(col, callback, ...constraints) {
  const q = constraints.length
    ? db.query(db.collection(db.instance, col), ...constraints)
    : db.collection(db.instance, col);
  return db.onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

async function uploadFile(file, path) {
  const fileRef = storage.ref(storage.instance, path);
  await storage.uploadBytes(fileRef, file);
  return await storage.getDownloadURL(fileRef);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE FORMATAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (d) => {
  if (!d) return "—";
  if (d?.toDate) d = d.toDate();
  return new Date(typeof d === "string" ? d + "T12:00:00" : d)
    .toLocaleDateString("pt-BR");
};
const fmtUSD = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

const STATUS_CONFIG = {
  analyst_review: { label: "Em Análise", color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  approved:       { label: "Aprovado ✓", color: "#10B981", bg: "rgba(16,185,129,0.15)" },
  pending:        { label: "Pendente",   color: "#6B7280", bg: "rgba(107,114,128,0.15)" },
  denied:         { label: "Negado",     color: "#EF4444", bg: "rgba(239,68,68,0.15)" },
  audit:          { label: "Auditoria",  color: "#8B5CF6", bg: "rgba(139,92,246,0.15)" },
  submitted:      { label: "Submetido",  color: "#3B82F6", bg: "rgba(59,130,246,0.15)" },
};

// ─────────────────────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 16, padding: 24, ...style,
    }}>
      {children}
    </div>
  );
}

function Badge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  return (
    <span style={{
      padding: "3px 11px", borderRadius: 20, fontSize: 12,
      fontWeight: 600, color: cfg.color, background: cfg.bg,
    }}>
      {cfg.label}
    </span>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</label>}
      <input {...props} style={{
        width: "100%", marginTop: 6, padding: "11px 14px",
        background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 10, color: "#fff", fontSize: 14, outline: "none",
        boxSizing: "border-box", fontFamily: "inherit", ...props.style,
      }} />
    </div>
  );
}

function Btn({ children, variant = "primary", ...props }) {
  const styles = {
    primary: { background: "linear-gradient(135deg,#C8A96E,#E8C87A)", color: "#0A0F1E", border: "none" },
    ghost:   { background: "rgba(255,255,255,0.07)", color: "#fff", border: "1px solid rgba(255,255,255,0.12)" },
    danger:  { background: "rgba(239,68,68,0.12)", color: "#F87171", border: "1px solid rgba(239,68,68,0.25)" },
    success: { background: "rgba(16,185,129,0.15)", color: "#10B981", border: "1px solid rgba(16,185,129,0.3)" },
  };
  return (
    <button {...props} style={{
      padding: "9px 20px", borderRadius: 9, fontWeight: 700,
      fontSize: 13, cursor: "pointer", fontFamily: "inherit",
      ...styles[variant], ...props.style,
    }}>
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        border: "3px solid rgba(200,169,110,0.2)",
        borderTopColor: "#E8C87A",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
    }}>
      <Card style={{ width: 460, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ color: "#E8C87A", margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        {children}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    setError(""); setLoading(true);
    try {
      await loadFirebase();
      const cred = await auth.signInWithEmailAndPassword(auth.instance, email, password);
      const userDoc = await firestoreGet("users", cred.user.uid);
      if (!userDoc) throw new Error("Perfil não encontrado.");
      onLogin({ uid: cred.user.uid, ...userDoc });
    } catch (e) {
      setError(e.code === "auth/invalid-credential" ? "E-mail ou senha incorretos." : e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg,#0A0F1E 0%,#111827 60%,#0D1B2A 100%)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "'Georgia',serif",
    }}>
      <div style={{
        width: 420, padding: "48px 40px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 20, backdropFilter: "blur(20px)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: "linear-gradient(135deg,#C8A96E,#E8C87A)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px", fontSize: 24, fontWeight: "bold", color: "#0A0F1E",
          }}>Z</div>
          <h1 style={{ color: "#E8C87A", fontSize: 26, fontWeight: 700, margin: 0 }}>Zion Solutions</h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 6 }}>Portal do Cliente</p>
        </div>

        <Input label="E-mail" type="email" value={email}
          onChange={e => setEmail(e.target.value)} placeholder="seu@email.com" />
        <Input label="Senha" type="password" value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handle()} />

        {error && <p style={{ color: "#F87171", fontSize: 13, marginBottom: 14, textAlign: "center" }}>{error}</p>}

        <Btn onClick={handle} disabled={loading} style={{ width: "100%", padding: 14, fontSize: 15, opacity: loading ? 0.7 : 1 }}>
          {loading ? "Entrando…" : "Entrar"}
        </Btn>

        <div style={{ marginTop: 28, padding: 16, background: "rgba(255,255,255,0.03)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)" }}>
          <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, margin: "0 0 8px", textAlign: "center" }}>
            ⚙️ Configure o Firebase antes de usar
          </p>
          <p style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, margin: 0, lineHeight: 1.6 }}>
            1. Crie um projeto em firebase.google.com<br />
            2. Ative Authentication (Email/Password)<br />
            3. Crie o Firestore Database<br />
            4. Ative o Storage<br />
            5. Substitua FIREBASE_CONFIG no topo do código<br />
            6. Crie os usuários via Firebase Console
          </p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SIDEBAR
// ─────────────────────────────────────────────────────────────────────────────
function Sidebar({ user, active, setActive, onLogout }) {
  const isAdmin = user.role === "admin";
  const nav = isAdmin
    ? [
        { id: "dashboard", icon: "⊞", label: "Dashboard" },
        { id: "clients",   icon: "👥", label: "Clientes" },
        { id: "messages",  icon: "✉",  label: "Mensagens" },
        { id: "payments",  icon: "💳", label: "Pagamentos" },
        { id: "cases",     icon: "📋", label: "Processos" },
        { id: "bulletin",  icon: "🗓",  label: "Visa Bulletin" },
        { id: "reports",   icon: "📊", label: "Relatórios" },
      ]
    : [
        { id: "dashboard", icon: "⊞", label: "Início" },
        { id: "messages",  icon: "✉",  label: "Mensagens" },
        { id: "payments",  icon: "💳", label: "Financeiro" },
        { id: "cases",     icon: "📋", label: "Meu Processo" },
        { id: "bulletin",  icon: "🗓",  label: "Visa Bulletin" },
        { id: "reports",   icon: "📊", label: "Relatórios" },
      ];

  return (
    <div style={{
      width: 220, minHeight: "100vh", background: "#080D1A",
      display: "flex", flexDirection: "column",
      borderRight: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div style={{ padding: "28px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: "linear-gradient(135deg,#C8A96E,#E8C87A)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: "bold", color: "#0A0F1E", fontSize: 16,
          }}>Z</div>
          <div>
            <div style={{ color: "#E8C87A", fontWeight: 700, fontSize: 13 }}>Zion Solutions</div>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>{isAdmin ? "Administrador" : "Cliente"}</div>
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "14px 10px" }}>
        {nav.map(item => (
          <button key={item.id} onClick={() => setActive(item.id)} style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px",
            background: active === item.id ? "rgba(200,169,110,0.12)" : "transparent",
            border: "none", borderRadius: 10,
            color: active === item.id ? "#E8C87A" : "rgba(255,255,255,0.45)",
            fontSize: 13, cursor: "pointer", textAlign: "left", marginBottom: 2,
            borderLeft: active === item.id ? "2px solid #E8C87A" : "2px solid transparent",
          }}>
            <span style={{ fontSize: 15 }}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div style={{ padding: "14px 10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ padding: "8px 12px", marginBottom: 8 }}>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600 }}>
            {user.name?.split(" ")[0]}
          </div>
          <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11 }}>{user.email}</div>
        </div>
        <Btn variant="danger" onClick={onLogout} style={{ width: "100%", textAlign: "center" }}>Sair</Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ user, messages, payments, caseStatus }) {
  const isAdmin = user.role === "admin";

  if (isAdmin) {
    const pending = payments.filter(p => p.status === "pending_review").length;
    const unread  = messages.filter(m => !m.read).length;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
        {[
          { label: "Pagamentos pendentes", value: pending, color: pending > 0 ? "#F59E0B" : "#10B981" },
          { label: "Mensagens não lidas",  value: unread,  color: unread  > 0 ? "#60A5FA" : "#10B981" },
          { label: "Clientes ativos",      value: "—",     color: "#E8C87A" },
        ].map(item => (
          <Card key={item.label}>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, marginBottom: 8 }}>{item.label}</div>
            <div style={{ color: item.color, fontSize: 40, fontWeight: 700 }}>{item.value}</div>
          </Card>
        ))}
      </div>
    );
  }

  const stages    = caseStatus || [];
  const active    = stages.find(s => s.status !== "pending" && s.status !== "approved") || stages[0];
  const totalPaid = payments.filter(p => p.status === "confirmed").reduce((s, p) => s + (p.amount || 0), 0);
  const totalOwed = 14000;
  const pct       = Math.min(100, Math.round((totalPaid / totalOwed) * 100));
  const unread    = messages.filter(m => !m.read).length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <Card>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Processo</div>
        <div style={{ color: "#E8C87A", fontSize: 22, fontWeight: 700 }}>{user.caseType || "EB-3"}</div>
        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, marginTop: 4 }}>Sponsor: {user.sponsor || "—"}</div>
        <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginTop: 4 }}>Priority Date: {fmt(user.priorityDate)}</div>
      </Card>
      <Card>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Etapa Atual</div>
        <div style={{ color: "#fff", fontSize: 18, fontWeight: 700 }}>{active?.stage || "—"}</div>
        <div style={{ marginTop: 10 }}>{active && <Badge status={active.status} />}</div>
        <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 8 }}>{active?.note}</div>
      </Card>
      <Card style={{ gridColumn: "1/-1" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em" }}>Financeiro</span>
          <span style={{ color: "#E8C87A", fontWeight: 700 }}>{fmtUSD(totalPaid)} / {fmtUSD(totalOwed)}</span>
        </div>
        <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 99, height: 10, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg,#C8A96E,#E8C87A)", borderRadius: 99, transition: "width 1s ease" }} />
        </div>
        <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 8 }}>{pct}% pago · Falta {fmtUSD(totalOwed - totalPaid)}</div>
      </Card>
      <Card>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Mensagens não lidas</div>
        <div style={{ color: unread > 0 ? "#E8C87A" : "#fff", fontSize: 40, fontWeight: 700 }}>{unread}</div>
      </Card>
      <Card>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8 }}>Pagamentos confirmados</div>
        <div style={{ color: "#10B981", fontSize: 40, fontWeight: 700 }}>
          {payments.filter(p => p.status === "confirmed").length}
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────────────────────────────────────
function MessagesView({ user, messages, setMessages, clients }) {
  const isAdmin = user.role === "admin";
  const [selected, setSelected] = useState(null);
  const [compose, setCompose] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ clientId: "", subject: "", body: "", source: "zion" });

  const list = isAdmin ? messages : messages.filter(m => m.clientId === user.clientId);

  const open = async (msg) => {
    setSelected(msg);
    if (!msg.read) {
      await firestoreUpdate("messages", msg.id, { read: true });
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m));
    }
  };

  const send = async () => {
    if (!form.subject || !form.body || (!isAdmin ? false : !form.clientId)) return;
    setSending(true);
    try {
      const data = {
        clientId: isAdmin ? form.clientId : user.clientId,
        from: isAdmin ? "Zion Solutions" : user.name,
        subject: form.subject,
        body: form.body,
        source: isAdmin ? form.source : "client",
        date: new Date().toISOString().split("T")[0],
        read: false,
      };
      const id = await firestoreAdd("messages", data);
      setMessages(prev => [{ id, ...data }, ...prev]);
      setCompose(false);
      setForm({ clientId: "", subject: "", body: "", source: "zion" });
    } finally { setSending(false); }
  };

  return (
    <div style={{ display: "flex", gap: 20, height: "calc(100vh - 130px)" }}>
      {/* Lista */}
      <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 10 }}>
        <Btn onClick={() => setCompose(true)} style={{ width: "100%", textAlign: "center" }}>
          + Nova Mensagem
        </Btn>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
          {list.length === 0 && <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", paddingTop: 30, fontSize: 13 }}>Nenhuma mensagem</div>}
          {list.map(msg => (
            <div key={msg.id} onClick={() => open(msg)} style={{
              padding: "13px 15px",
              background: selected?.id === msg.id ? "rgba(200,169,110,0.12)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${selected?.id === msg.id ? "rgba(200,169,110,0.35)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: 12, cursor: "pointer",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: msg.source === "zion" ? "#E8C87A" : msg.source === "sponsor" ? "#60A5FA" : msg.source === "client" ? "#A78BFA" : "rgba(255,255,255,0.4)" }}>
                  {msg.source === "zion" ? "Zion Solutions" : msg.source === "sponsor" ? "Sponsor" : msg.source === "client" ? (isAdmin ? msg.from : "Você") : msg.from}
                </span>
                {!msg.read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#E8C87A", display: "inline-block" }} />}
              </div>
              <div style={{ color: "#fff", fontSize: 13, fontWeight: msg.read ? 400 : 600, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{msg.subject}</div>
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>{fmt(msg.date)}</div>
              {isAdmin && <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 10, marginTop: 2 }}>→ {msg.clientId}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Conteúdo */}
      <Card style={{ flex: 1, overflow: "auto" }}>
        {selected ? (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <div>
                <h2 style={{ color: "#fff", margin: "0 0 8px", fontSize: 20 }}>{selected.subject}</h2>
                <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>De: {selected.from} · {fmt(selected.date)}</div>
              </div>
              <span style={{
                padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 600,
                background: selected.source === "zion" ? "rgba(200,169,110,0.12)" : selected.source === "sponsor" ? "rgba(96,165,250,0.12)" : "rgba(167,139,250,0.12)",
                color: selected.source === "zion" ? "#E8C87A" : selected.source === "sponsor" ? "#60A5FA" : "#A78BFA",
              }}>
                {selected.source === "zion" ? "Zion Solutions" : selected.source === "sponsor" ? "Sponsor" : isAdmin ? selected.from : "Você"}
              </span>
            </div>
            <div style={{ color: "rgba(255,255,255,0.8)", lineHeight: 1.75, fontSize: 14, whiteSpace: "pre-wrap" }}>{selected.body}</div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "rgba(255,255,255,0.25)", fontSize: 14 }}>
            Selecione uma mensagem
          </div>
        )}
      </Card>

      {compose && (
        <Modal title={isAdmin ? "Nova Mensagem" : "Enviar Mensagem para Zion"} onClose={() => setCompose(false)}>
          {isAdmin && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Cliente</label>
              <select value={form.clientId} onChange={e => setForm(p => ({ ...p, clientId: e.target.value }))}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, color: "#fff", fontSize: 13 }}>
                <option value="" style={{ background: "#1a1a2e" }}>Selecione…</option>
                {clients.map(c => <option key={c.id} value={c.clientId || c.id} style={{ background: "#1a1a2e" }}>{c.name}</option>)}
              </select>
            </div>
          )}
          {isAdmin && (
            <div style={{ marginBottom: 14 }}>
              <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 12 }}>Origem</label>
              <select value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))}
                style={{ width: "100%", marginTop: 6, padding: "10px 12px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 9, color: "#fff", fontSize: 13 }}>
                <option value="zion" style={{ background: "#1a1a2e" }}>Zion Solutions</option>
                <option value="sponsor" style={{ background: "#1a1a2e" }}>Sponsor</option>
              </select>
            </div>
          )}
          {!isAdmin && (
            <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", borderRadius: 10 }}>
              <span style={{ color: "#A78BFA", fontSize: 13 }}>✉ Para: <strong>Zion Solutions</strong></span>
            </div>
          )}
          <Input label="Assunto" value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
          <div style={{ marginBottom: 20 }}>
            <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Mensagem</label>
            <textarea value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} rows={6}
              style={{ width: "100%", marginTop: 6, padding: "11px 14px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, color: "#fff", fontSize: 14, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={send} disabled={sending}>{sending ? "Enviando…" : "Enviar"}</Btn>
            <Btn variant="ghost" onClick={() => setCompose(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────────────────────────────────────
function PaymentsView({ user, payments, setPayments }) {
  const isAdmin = user.role === "admin";
  const [modal, setModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({ description: "", amount: "" });
  const [file, setFile] = useState(null);

  const myPayments = isAdmin ? payments : payments.filter(p => p.clientId === user.clientId);
  const confirmed  = myPayments.filter(p => p.status === "confirmed").reduce((s, p) => s + (p.amount || 0), 0);
  const totalOwed  = 14000;
  const pct        = Math.min(100, Math.round((confirmed / totalOwed) * 100));

  const submitPayment = async () => {
    if (!form.description || !form.amount) return;
    setUploading(true);
    try {
      let receiptUrl = null;
      if (file) {
        receiptUrl = await uploadFile(file, `receipts/${user.clientId}/${Date.now()}_${file.name}`);
      }
      const data = {
        clientId: user.clientId,
        description: form.description,
        amount: Number(form.amount),
        date: new Date().toISOString().split("T")[0],
        status: "pending_review",
        receiptUrl,
        receiptName: file?.name || null,
      };
      const id = await firestoreAdd("payments", data);
      setPayments(prev => [{ id, ...data }, ...prev]);
      setModal(false); setForm({ description: "", amount: "" }); setFile(null);
    } finally { setUploading(false); }
  };

  const changeStatus = async (id, status) => {
    await firestoreUpdate("payments", id, { status });
    setPayments(prev => prev.map(p => p.id === id ? { ...p, status } : p));
  };

  const planStages = [
    { label: "Assinatura do contrato",           amount: 3500, done: true },
    { label: "10 parcelas semanais ($550 cada)", amount: 5500, done: false },
    { label: "Aplicação do I-140",               amount: 4500, done: false },
    { label: "Dependente (Tairini)",             amount: 500,  done: false },
    { label: "Taxas USCIS (governo)",            amount: null, done: false, note: "A definir" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Balanço */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ color: "#E8C87A", margin: 0 }}>Balanço Financeiro</h3>
          {!isAdmin && <Btn onClick={() => setModal(true)}>+ Enviar Comprovante</Btn>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
          {[
            { label: "Total do processo", value: fmtUSD(totalOwed),           color: "#fff" },
            { label: "Pago até agora",    value: fmtUSD(confirmed),           color: "#10B981" },
            { label: "Saldo restante",    value: fmtUSD(totalOwed - confirmed), color: "#F59E0B" },
          ].map(item => (
            <div key={item.label} style={{ padding: 16, background: "rgba(255,255,255,0.04)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginBottom: 6 }}>{item.label}</div>
              <div style={{ color: item.color, fontSize: 22, fontWeight: 700 }}>{item.value}</div>
            </div>
          ))}
        </div>
        <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 99, height: 10, overflow: "hidden", marginBottom: 8 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg,#C8A96E,#E8C87A)", borderRadius: 99, transition: "width 1s ease" }} />
        </div>
        <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12 }}>{pct}% pago</div>
      </Card>

      {/* Plano */}
      <Card>
        <h3 style={{ color: "#E8C87A", margin: "0 0 16px", fontSize: 15 }}>Plano de Pagamento</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {planStages.map((s, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "12px 16px",
              background: s.done ? "rgba(16,185,129,0.07)" : "rgba(255,255,255,0.04)",
              borderRadius: 10,
              border: `1px solid ${s.done ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.07)"}`,
            }}>
              <span style={{ color: "#fff", fontSize: 13 }}>{s.label}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ color: s.done ? "#10B981" : "rgba(255,255,255,0.6)", fontWeight: 600 }}>
                  {s.amount ? fmtUSD(s.amount) : s.note}
                </span>
                <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 99, background: s.done ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.07)", color: s.done ? "#10B981" : "rgba(255,255,255,0.35)" }}>
                  {s.done ? "Pago ✓" : "Pendente"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Histórico */}
      <Card>
        <h3 style={{ color: "#E8C87A", margin: "0 0 16px", fontSize: 15 }}>Histórico de Pagamentos</h3>
        {myPayments.length === 0
          ? <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: 20 }}>Nenhum pagamento registrado</div>
          : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {myPayments.map(p => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "rgba(255,255,255,0.04)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div>
                    <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{p.description}</div>
                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginTop: 2 }}>
                      {fmt(p.date)}
                      {p.receiptUrl && (
                        <a href={p.receiptUrl} target="_blank" rel="noreferrer"
                          style={{ color: "#60A5FA", marginLeft: 10, fontSize: 12 }}>
                          📎 Ver comprovante
                        </a>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ color: "#E8C87A", fontWeight: 700 }}>{fmtUSD(p.amount)}</span>
                    {p.status === "confirmed"      && <span style={{ color: "#10B981", fontSize: 12 }}>✓ Confirmado</span>}
                    {p.status === "rejected"       && <span style={{ color: "#EF4444", fontSize: 12 }}>✗ Rejeitado</span>}
                    {p.status === "pending_review" && (
                      isAdmin ? (
                        <div style={{ display: "flex", gap: 6 }}>
                          <Btn variant="success" style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => changeStatus(p.id, "confirmed")}>Confirmar</Btn>
                          <Btn variant="danger"  style={{ padding: "4px 10px", fontSize: 11 }} onClick={() => changeStatus(p.id, "rejected")}>Rejeitar</Btn>
                        </div>
                      ) : <span style={{ color: "#F59E0B", fontSize: 12 }}>⏳ Em revisão</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </Card>

      {modal && (
        <Modal title="Enviar Comprovante" onClose={() => setModal(false)}>
          <Input label="Descrição" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Ex: 2ª parcela semanal" />
          <Input label="Valor ($)" type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} />
          <div style={{ marginBottom: 20 }}>
            <label style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Comprovante (PDF ou imagem)</label>
            <div style={{ marginTop: 8, padding: 20, background: "rgba(255,255,255,0.04)", border: "2px dashed rgba(255,255,255,0.15)", borderRadius: 10, textAlign: "center" }}>
              <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files[0])}
                style={{ display: "none" }} id="receipt-upload" />
              <label htmlFor="receipt-upload" style={{ cursor: "pointer", color: file ? "#10B981" : "rgba(255,255,255,0.4)", fontSize: 13 }}>
                {file ? `✓ ${file.name}` : "📎 Clique para selecionar arquivo"}
              </label>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={submitPayment} disabled={uploading}>{uploading ? "Enviando…" : "Enviar"}</Btn>
            <Btn variant="ghost" onClick={() => setModal(false)}>Cancelar</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CASE STATUS
// ─────────────────────────────────────────────────────────────────────────────
function CasesView({ user, caseStatus, setCaseStatus, clientData }) {
  const isAdmin = user.role === "admin";
  const [editing, setEditing] = useState(null);
  const [editData, setEditData] = useState({});
  const [saving, setSaving] = useState(false);

  const clientId = user.clientId || user.id;
  const stages = caseStatus || [];

  // Protocolos do cliente (próprio ou do clientData passado pelo admin)
  const protocols = (isAdmin ? clientData?.protocols : user.protocols) || {};

  const startEdit = (s) => { setEditing(s.id); setEditData({ status: s.status, note: s.note || "", date: s.date || "" }); };

  const saveEdit = async (stageId) => {
    setSaving(true);
    try {
      const updated = stages.map(s => s.id === stageId ? { ...s, ...editData } : s);
      await firestoreUpdate("caseStatus", clientId, { stages: updated });
      setCaseStatus(updated);
      setEditing(null);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        {/* ── Cabeçalho com nome e protocolos ── */}
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ color: "#E8C87A", margin: "0 0 6px" }}>
            Status do Processo — {user.caseType || "EB-3"}
          </h3>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginBottom: 12 }}>
            {isAdmin ? (clientData?.name || "—") : user.name} · Sponsor: {user.sponsor || clientData?.sponsor || "—"}
          </div>

          {/* Protocolos cadastrados */}
          {PROTOCOL_SITES.some(s => protocols[s.id]) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PROTOCOL_SITES.filter(s => protocols[s.id]).map(site => (
                <div key={site.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10 }}>
                  <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{site.label}</span>
                  <code style={{ color: "#E8C87A", fontSize: 12, fontFamily: "monospace" }}>{protocols[site.id]}</code>
                  <a href={site.url} target="_blank" rel="noreferrer"
                    style={{ color: "#60A5FA", fontSize: 11, textDecoration: "none" }} title="Verificar no site oficial">
                    🔗
                  </a>
                </div>
              ))}
            </div>
          )}

          {!PROTOCOL_SITES.some(s => protocols[s.id]) && (
            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 12, fontStyle: "italic" }}>
              {isAdmin ? "Nenhum protocolo cadastrado para este cliente." : "Nenhum número de protocolo cadastrado ainda."}
            </div>
          )}
        </div>

        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 24 }}>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 19, top: 10, bottom: 10, width: 2, background: "rgba(255,255,255,0.07)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {stages.map((stage) => {
                const cfg = STATUS_CONFIG[stage.status] || STATUS_CONFIG.pending;
                return (
                  <div key={stage.id} style={{ display: "flex", gap: 20, paddingBottom: 24, position: "relative" }}>
                    <div style={{ width: 40, display: "flex", justifyContent: "center", flexShrink: 0, zIndex: 1 }}>
                      <div style={{ width: 20, height: 20, borderRadius: "50%", background: cfg.color, marginTop: 6, boxShadow: `0 0 10px ${cfg.color}66` }} />
                    </div>
                    <div style={{ flex: 1, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, padding: "14px 16px" }}>
                      {editing === stage.id ? (
                        <div>
                          <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                            <select value={editData.status} onChange={e => setEditData(p => ({ ...p, status: e.target.value }))}
                              style={{ flex: 1, padding: "8px 10px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#fff", fontSize: 13 }}>
                              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k} style={{ background: "#0D1117" }}>{v.label}</option>)}
                            </select>
                            <input type="date" value={editData.date} onChange={e => setEditData(p => ({ ...p, date: e.target.value }))}
                              style={{ padding: "8px 10px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#fff", fontSize: 13 }} />
                          </div>
                          <input value={editData.note} onChange={e => setEditData(p => ({ ...p, note: e.target.value }))} placeholder="Observação"
                            style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "#fff", fontSize: 13, boxSizing: "border-box", marginBottom: 10, fontFamily: "inherit" }} />
                          <div style={{ display: "flex", gap: 8 }}>
                            <Btn style={{ padding: "6px 16px", fontSize: 12 }} onClick={() => saveEdit(stage.id)} disabled={saving}>{saving ? "…" : "Salvar"}</Btn>
                            <Btn variant="ghost" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => setEditing(null)}>Cancelar</Btn>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                          <div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                              <span style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{stage.stage}</span>
                              <Badge status={stage.status} />
                            </div>
                            {stage.date && <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, marginBottom: 4 }}>Data: {fmt(stage.date)}</div>}
                            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>{stage.note}</div>
                          </div>
                          {isAdmin && (
                            <Btn variant="ghost" style={{ padding: "5px 12px", fontSize: 12, flexShrink: 0 }} onClick={() => startEdit(stage)}>Editar</Btn>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VISA BULLETIN
// ─────────────────────────────────────────────────────────────────────────────
function BulletinView({ user }) {
  const isAdmin = user.role === "admin";
  const [bulletin, setBulletin] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!db) return;
    firestoreGet("bulletin", "current").then(data => {
      if (data) { setBulletin(data); setDraft(data); }
      else {
        const def = {
          month: "Abril 2026", updated: "2026-04-01", source: "travel.state.gov",
          eb3:        { brazil: { finalAction: "2024-06-01", datesForFiling: "Current" } },
          eb3Unskilled: { brazil: { finalAction: "2021-11-01", datesForFiling: "2022-08-01" } },
        };
        setBulletin(def); setDraft(def);
      }
    });
  }, []);

  const saveBulletin = async () => {
    setSaving(true);
    try {
      const snap = await db.getDoc(db.doc(db.instance, "bulletin", "current"));
      if (snap.exists()) await firestoreUpdate("bulletin", "current", draft);
      else await db.addDoc(db.collection(db.instance, "bulletin"), { ...draft });
      setBulletin(draft); setEditing(false);
    } finally { setSaving(false); }
  };

  if (!bulletin) return <Spinner />;

  const b = editing ? draft : bulletin;
  const setB = (key, subkey, field, val) => setDraft(p => ({ ...p, [key]: { ...p[key], [subkey]: { ...p[key][subkey], [field]: val } } }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h3 style={{ color: "#E8C87A", margin: "0 0 4px" }}>Visa Bulletin — {b.month}</h3>
            <p style={{ color: "rgba(255,255,255,0.3)", margin: 0, fontSize: 12 }}>
              Fonte: {b.source} · Atualizado: {fmt(b.updated)}
            </p>
          </div>
          {isAdmin && !editing && <Btn variant="ghost" onClick={() => setEditing(true)}>Editar Bulletin</Btn>}
          {isAdmin && editing && (
            <div style={{ display: "flex", gap: 8 }}>
              <Btn onClick={saveBulletin} disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Btn>
              <Btn variant="ghost" onClick={() => { setEditing(false); setDraft(bulletin); }}>Cancelar</Btn>
            </div>
          )}
        </div>

        {editing && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20, paddingBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <Input label="Mês" value={draft.month} onChange={e => setDraft(p => ({ ...p, month: e.target.value }))} />
            <Input label="Data de atualização" type="date" value={draft.updated} onChange={e => setDraft(p => ({ ...p, updated: e.target.value }))} />
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          {[
            { title: "EB-3 Skilled Workers", key: "eb3", color: "#E8C87A" },
            { title: "EB-3 Other Workers (Unskilled)", key: "eb3Unskilled", color: "#60A5FA" },
          ].map(({ title, key, color }) => (
            <div key={key} style={{ padding: 20, background: "rgba(255,255,255,0.04)", borderRadius: 14, border: "1px solid rgba(255,255,255,0.08)" }}>
              <h4 style={{ color, margin: "0 0 16px", fontSize: 14 }}>{title}</h4>
              {[
                { label: "Final Action Date", field: "finalAction" },
                { label: "Dates for Filing", field: "datesForFiling" },
              ].map(({ label, field }) => (
                <div key={field} style={{ marginBottom: 14 }}>
                  <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginBottom: 4 }}>BRASIL — {label}</div>
                  {editing
                    ? <input value={b[key].brazil[field]} onChange={e => setB(key, "brazil", field, e.target.value)}
                        style={{ width: "100%", padding: "7px 10px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 7, color: "#fff", fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" }} />
                    : <div style={{ color: b[key].brazil[field] === "Current" ? "#10B981" : color, fontWeight: 700, fontSize: 16 }}>
                        {b[key].brazil[field] === "Current" ? "🟢 Current" : fmt(b[key].brazil[field])}
                      </div>
                  }
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h4 style={{ color: "#E8C87A", margin: "0 0 12px" }}>Sua Situação</h4>
        <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, padding: 16 }}>
          <div style={{ color: "#F59E0B", fontWeight: 600, marginBottom: 8 }}>⚠️ Aguardando avanço do Bulletin</div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, lineHeight: 1.7 }}>
            Sua priority date é <strong style={{ color: "#fff" }}>27/03/2026</strong>.
            O EB-3 Unskilled para Brasil está analisando datas de <strong style={{ color: "#fff" }}>{fmt(bulletin.eb3Unskilled?.brazil?.datesForFiling)}</strong>.
            O Bulletin precisa avançar aprox. <strong style={{ color: "#fff" }}>3 anos e 7 meses</strong> para você poder protocolar o I-485.
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MINI CHART COMPONENTS (sem dependências externas)
// ─────────────────────────────────────────────────────────────────────────────
function BarChart({ data, color = "#E8C87A", height = 120 }) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>{fmtUSD(d.value)}</div>
          <div style={{
            width: "100%", borderRadius: "4px 4px 0 0",
            height: `${Math.max(4, (d.value / max) * (height - 36))}px`,
            background: `linear-gradient(180deg, ${color}, ${color}88)`,
            transition: "height 0.6s ease",
          }} />
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textAlign: "center", whiteSpace: "nowrap" }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ segments, size = 140 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  let cumulative = 0;
  const r = 50, cx = 70, cy = 70, strokeW = 18;
  const circumference = 2 * Math.PI * r;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <svg width={size} height={size} viewBox="0 0 140 140">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeW} />
        {segments.map((seg, i) => {
          const pct = seg.value / total;
          const offset = circumference * (1 - pct);
          const rotation = cumulative * 360 - 90;
          cumulative += pct;
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={strokeW}
              strokeDasharray={`${circumference * pct} ${circumference * (1 - pct)}`}
              strokeDashoffset={circumference * 0.25}
              transform={`rotate(${rotation} ${cx} ${cy})`}
              style={{ transition: "stroke-dasharray 0.8s ease" }}
            />
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9">total</text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 12 }}>{seg.label}</span>
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, marginLeft: 4 }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressRow({ label, value, total, color }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>{label}</span>
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>{fmtUSD(value)} <span style={{ color: "rgba(255,255,255,0.35)", fontWeight: 400 }}>({pct}%)</span></span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 99, height: 7 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.8s ease" }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRINT HELPER
// ─────────────────────────────────────────────────────────────────────────────
function printReport(id, title) {
  const el = document.getElementById(id);
  if (!el) return;
  const w = window.open("", "_blank");
  w.document.write(`
    <html><head><title>${title}</title>
    <style>
      body { font-family: Georgia, serif; background: #fff; color: #111; padding: 32px; }
      h1 { color: #8B6914; border-bottom: 2px solid #C8A96E; padding-bottom: 8px; }
      h2,h3 { color: #5a4a1a; }
      table { width: 100%; border-collapse: collapse; margin: 16px 0; }
      th { background: #f5ecd7; color: #5a4a1a; padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
      td { padding: 8px 12px; border-bottom: 1px solid #e5d5b0; font-size: 13px; }
      .stat { display: inline-block; background: #fdf6e3; border: 1px solid #e5d5b0; border-radius: 8px; padding: 12px 20px; margin: 8px; }
      .stat-val { font-size: 24px; font-weight: bold; color: #8B6914; }
      .stat-lbl { font-size: 11px; color: #888; }
      .badge { padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: bold; }
      .green { background: #d1fae5; color: #065f46; }
      .yellow { background: #fef3c7; color: #92400e; }
      .gray { background: #f3f4f6; color: #374151; }
      .red { background: #fee2e2; color: #991b1b; }
      footer { margin-top: 40px; color: #aaa; font-size: 11px; border-top: 1px solid #e5d5b0; padding-top: 12px; }
    </style></head><body>
    <h1>Zion Solutions — ${title}</h1>
    <p style="color:#888;font-size:12px">Gerado em ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
    ${el.getAttribute("data-print-html") || el.innerText}
    <footer>Zion Solutions · Portal do Cliente · Documento gerado automaticamente</footer>
    </body></html>
  `);
  w.document.close();
  setTimeout(() => { w.print(); }, 400);
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS — CLIENTE (Relatório Financeiro Pessoal)
// ─────────────────────────────────────────────────────────────────────────────
function ClientReports({ user, payments }) {
  const myPayments = payments.filter(p => p.clientId === user.clientId);
  const confirmed  = myPayments.filter(p => p.status === "confirmed");
  const pending    = myPayments.filter(p => p.status === "pending_review");
  const rejected   = myPayments.filter(p => p.status === "rejected");

  const totalPago    = confirmed.reduce((s, p) => s + (p.amount || 0), 0) + 3500;
  const totalPendente = pending.reduce((s, p) => s + (p.amount || 0), 0);
  const totalProcesso = 14000;
  const faltando     = totalProcesso - totalPago;
  const pct          = Math.min(100, Math.round((totalPago / totalProcesso) * 100));

  // Agrupar por mês
  const byMonth = {};
  confirmed.forEach(p => {
    const m = p.date ? p.date.substring(0, 7) : "—";
    byMonth[m] = (byMonth[m] || 0) + (p.amount || 0);
  });
  const monthData = Object.entries(byMonth).sort().map(([k, v]) => ({
    label: k === "—" ? "—" : new Date(k + "-15").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
    value: v,
  }));

  const planStages = [
    { label: "Assinatura do contrato",    amount: 3500, paid: true },
    { label: "10 parcelas ($550 cada)",   amount: 5500, paid: false },
    { label: "Aplicação do I-140",        amount: 4500, paid: false },
    { label: "Dependente (Tairini)",      amount: 500,  paid: false },
  ];

  const printHTML = `
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px">
      <div class="stat"><div class="stat-val">$${totalPago.toLocaleString("en-US",{minimumFractionDigits:2})}</div><div class="stat-lbl">Total Pago</div></div>
      <div class="stat"><div class="stat-val">$${faltando.toLocaleString("en-US",{minimumFractionDigits:2})}</div><div class="stat-lbl">Saldo Restante</div></div>
      <div class="stat"><div class="stat-val">${pct}%</div><div class="stat-lbl">Progresso</div></div>
      <div class="stat"><div class="stat-val">${confirmed.length + 1}</div><div class="stat-lbl">Pagamentos Confirmados</div></div>
    </div>
    <h2>Plano de Pagamento</h2>
    <table><tr><th>Etapa</th><th>Valor</th><th>Status</th></tr>
      ${planStages.map(s => `<tr><td>${s.label}</td><td>$${s.amount.toLocaleString("en-US",{minimumFractionDigits:2})}</td><td><span class="badge ${s.paid ? "green" : "gray"}">${s.paid ? "Pago" : "Pendente"}</span></td></tr>`).join("")}
    </table>
    <h2>Histórico de Pagamentos</h2>
    <table><tr><th>Descrição</th><th>Data</th><th>Valor</th><th>Status</th></tr>
      <tr><td>Assinatura do contrato</td><td>—</td><td>$3,500.00</td><td><span class="badge green">Confirmado</span></td></tr>
      ${myPayments.map(p => `<tr><td>${p.description}</td><td>${fmt(p.date)}</td><td>$${(p.amount||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td><td><span class="badge ${p.status==="confirmed"?"green":p.status==="rejected"?"red":"yellow"}">${p.status==="confirmed"?"Confirmado":p.status==="rejected"?"Rejeitado":"Em Revisão"}</span></td></tr>`).join("")}
    </table>
  `;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ color: "#E8C87A", margin: 0 }}>Relatório Financeiro</h3>
          <p style={{ color: "rgba(255,255,255,0.35)", margin: "4px 0 0", fontSize: 13 }}>Processo EB-3 · {user.name}</p>
        </div>
        <Btn variant="ghost" onClick={() => printReport("client-report", "Relatório Financeiro — " + user.name)}>
          🖨 Imprimir / PDF
        </Btn>
      </div>

      <div id="client-report" data-print-html={printHTML}>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
          {[
            { label: "Total Pago",            value: fmtUSD(totalPago),    color: "#10B981" },
            { label: "Saldo Restante",        value: fmtUSD(faltando),     color: "#F59E0B" },
            { label: "Progresso",             value: `${pct}%`,            color: "#E8C87A" },
            { label: "Pagamentos Confirmados", value: confirmed.length + 1, color: "#60A5FA" },
          ].map(k => (
            <Card key={k.label} style={{ padding: 18, textAlign: "center" }}>
              <div style={{ color: k.color, fontSize: 26, fontWeight: 700 }}>{k.value}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 4 }}>{k.label}</div>
            </Card>
          ))}
        </div>

        {/* Barra geral */}
        <Card>
          <h4 style={{ color: "#E8C87A", margin: "0 0 16px" }}>Progresso Geral do Processo</h4>
          <ProgressRow label="Assinatura do contrato"  value={3500}  total={14000} color="#10B981" />
          <ProgressRow label="10 parcelas semanais"    value={confirmed.reduce((s,p)=>s+p.amount,0)} total={5500} color="#E8C87A" />
          <ProgressRow label="Aplicação do I-140"      value={0}     total={4500}  color="#60A5FA" />
          <ProgressRow label="Dependente (Tairini)"    value={0}     total={500}   color="#8B5CF6" />
        </Card>

        {/* Gráfico por mês */}
        {monthData.length > 0 && (
          <Card>
            <h4 style={{ color: "#E8C87A", margin: "0 0 20px" }}>Pagamentos por Período</h4>
            <BarChart data={monthData.length > 0 ? monthData : [{ label: "—", value: 0 }]} />
          </Card>
        )}

        {/* Plano de pagamento */}
        <Card>
          <h4 style={{ color: "#E8C87A", margin: "0 0 16px" }}>Plano de Pagamento</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {planStages.map((s, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 15px", background: s.paid ? "rgba(16,185,129,0.07)" : "rgba(255,255,255,0.04)", borderRadius: 10, border: `1px solid ${s.paid ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.07)"}` }}>
                <span style={{ color: "#fff", fontSize: 13 }}>{s.label}</span>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ color: s.paid ? "#10B981" : "rgba(255,255,255,0.5)", fontWeight: 600 }}>{fmtUSD(s.amount)}</span>
                  <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 99, background: s.paid ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.07)", color: s.paid ? "#10B981" : "rgba(255,255,255,0.35)" }}>
                    {s.paid ? "✓ Pago" : "Pendente"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Histórico */}
        <Card>
          <h4 style={{ color: "#E8C87A", margin: "0 0 16px" }}>Histórico Completo</h4>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Descrição", "Data", "Valor", "Status"].map(h => (
                  <th key={h} style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: "11px 12px", color: "#fff", fontSize: 13 }}>Assinatura do contrato</td>
                <td style={{ padding: "11px 12px", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>—</td>
                <td style={{ padding: "11px 12px", color: "#E8C87A", fontWeight: 600 }}>$3,500.00</td>
                <td style={{ padding: "11px 12px" }}><span style={{ color: "#10B981", fontSize: 12 }}>✓ Confirmado</span></td>
              </tr>
              {myPayments.map(p => (
                <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "11px 12px", color: "#fff", fontSize: 13 }}>{p.description}</td>
                  <td style={{ padding: "11px 12px", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{fmt(p.date)}</td>
                  <td style={{ padding: "11px 12px", color: "#E8C87A", fontWeight: 600 }}>{fmtUSD(p.amount)}</td>
                  <td style={{ padding: "11px 12px" }}>
                    {p.status === "confirmed"      && <span style={{ color: "#10B981", fontSize: 12 }}>✓ Confirmado</span>}
                    {p.status === "rejected"       && <span style={{ color: "#EF4444", fontSize: 12 }}>✗ Rejeitado</span>}
                    {p.status === "pending_review" && <span style={{ color: "#F59E0B", fontSize: 12 }}>⏳ Em revisão</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {myPayments.length === 0 && (
            <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: 20, fontSize: 13 }}>
              Apenas a assinatura registrada até o momento.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS — ADMIN (Financeiro + Status + Tipo de Processo)
// ─────────────────────────────────────────────────────────────────────────────
function AdminReports({ clients, payments }) {
  const [tab, setTab] = useState("financial");

  const tabs = [
    { id: "financial", label: "💰 Financeiro" },
    { id: "cases",     label: "📋 Status dos Casos" },
    { id: "types",     label: "🗂 Tipo de Processo" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, background: "rgba(255,255,255,0.04)", padding: 6, borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 20px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13,
            background: tab === t.id ? "linear-gradient(135deg,#C8A96E,#E8C87A)" : "transparent",
            color: tab === t.id ? "#0A0F1E" : "rgba(255,255,255,0.45)",
            transition: "all 0.2s",
          }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "financial" && <AdminFinancialReport clients={clients} payments={payments} />}
      {tab === "cases"     && <AdminCasesReport clients={clients} />}
      {tab === "types"     && <AdminTypesReport clients={clients} />}
    </div>
  );
}

function AdminFinancialReport({ clients, payments }) {
  const confirmed = payments.filter(p => p.status === "confirmed");
  const pending   = payments.filter(p => p.status === "pending_review");
  const totalArrecadado = confirmed.reduce((s, p) => s + (p.amount || 0), 0) + (clients.length * 3500);
  const totalEsperado   = clients.length * 14000;
  const totalPendente   = pending.reduce((s, p) => s + (p.amount || 0), 0);

  // Por cliente
  const perClient = clients.map(c => {
    const cp = confirmed.filter(p => p.clientId === (c.clientId || c.id));
    const paid = cp.reduce((s, p) => s + (p.amount || 0), 0) + 3500;
    return { name: c.name?.split(" ")[0] + " " + (c.name?.split(" ")[1] || ""), paid, total: 14000 };
  });

  // Por mês (todos clientes)
  const byMonth = {};
  confirmed.forEach(p => {
    const m = p.date ? p.date.substring(0, 7) : "—";
    byMonth[m] = (byMonth[m] || 0) + (p.amount || 0);
  });
  const monthData = Object.entries(byMonth).sort().map(([k, v]) => ({
    label: k === "—" ? "—" : new Date(k + "-15").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
    value: v,
  }));

  const printHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px">
      <div class="stat"><div class="stat-val">$${totalArrecadado.toLocaleString("en-US",{minimumFractionDigits:2})}</div><div class="stat-lbl">Total Arrecadado</div></div>
      <div class="stat"><div class="stat-val">$${(totalEsperado-totalArrecadado).toLocaleString("en-US",{minimumFractionDigits:2})}</div><div class="stat-lbl">A Receber</div></div>
      <div class="stat"><div class="stat-val">$${totalPendente.toLocaleString("en-US",{minimumFractionDigits:2})}</div><div class="stat-lbl">Em Revisão</div></div>
      <div class="stat"><div class="stat-val">${clients.length}</div><div class="stat-lbl">Clientes Ativos</div></div>
    </div>
    <h2>Resumo por Cliente</h2>
    <table><tr><th>Cliente</th><th>Pago</th><th>Total</th><th>%</th></tr>
      ${perClient.map(c => `<tr><td>${c.name}</td><td>$${c.paid.toLocaleString("en-US",{minimumFractionDigits:2})}</td><td>$${c.total.toLocaleString("en-US",{minimumFractionDigits:2})}</td><td>${Math.round((c.paid/c.total)*100)}%</td></tr>`).join("")}
    </table>
    <h2>Todos os Pagamentos</h2>
    <table><tr><th>Cliente</th><th>Descrição</th><th>Data</th><th>Valor</th><th>Status</th></tr>
      ${payments.map(p => {
        const c = clients.find(cl => (cl.clientId||cl.id) === p.clientId);
        return `<tr><td>${c?.name?.split(" ")[0] || p.clientId}</td><td>${p.description}</td><td>${fmt(p.date)}</td><td>$${(p.amount||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td><td><span class="badge ${p.status==="confirmed"?"green":p.status==="rejected"?"red":"yellow"}">${p.status==="confirmed"?"Confirmado":p.status==="rejected"?"Rejeitado":"Em Revisão"}</span></td></tr>`;
      }).join("")}
    </table>
  `;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ color: "#E8C87A", margin: 0 }}>Relatório Financeiro Geral</h3>
        <Btn variant="ghost" onClick={() => printReport("admin-fin-report", "Relatório Financeiro Geral")}>🖨 Imprimir / PDF</Btn>
      </div>

      <div id="admin-fin-report" data-print-html={printHTML}>
        {/* KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14 }}>
          {[
            { label: "Total Arrecadado",   value: fmtUSD(totalArrecadado),              color: "#10B981" },
            { label: "A Receber",          value: fmtUSD(totalEsperado - totalArrecadado), color: "#F59E0B" },
            { label: "Em Revisão",         value: fmtUSD(totalPendente),                color: "#60A5FA" },
            { label: "Clientes Ativos",    value: clients.length,                       color: "#E8C87A" },
          ].map(k => (
            <Card key={k.label} style={{ padding: 18, textAlign: "center" }}>
              <div style={{ color: k.color, fontSize: 24, fontWeight: 700 }}>{k.value}</div>
              <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 4 }}>{k.label}</div>
            </Card>
          ))}
        </div>

        {/* Gráfico mensal */}
        {monthData.length > 0 && (
          <Card>
            <h4 style={{ color: "#E8C87A", margin: "0 0 20px" }}>Receita por Período</h4>
            <BarChart data={monthData} color="#E8C87A" height={130} />
          </Card>
        )}

        {/* Por cliente */}
        {clients.length > 0 && (
          <Card>
            <h4 style={{ color: "#E8C87A", margin: "0 0 20px" }}>Progresso por Cliente</h4>
            {perClient.map((c, i) => (
              <ProgressRow key={i} label={c.name} value={c.paid} total={c.total} color={["#E8C87A", "#60A5FA", "#10B981", "#8B5CF6"][i % 4]} />
            ))}
            {perClient.length === 0 && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Nenhum cliente cadastrado.</div>}
          </Card>
        )}

        {/* Tabela completa */}
        <Card>
          <h4 style={{ color: "#E8C87A", margin: "0 0 16px" }}>Todos os Pagamentos</h4>
          {payments.length === 0
            ? <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: 20 }}>Nenhum pagamento registrado.</div>
            : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Cliente", "Descrição", "Data", "Valor", "Status"].map(h => (
                    <th key={h} style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {payments.map(p => {
                    const c = clients.find(cl => (cl.clientId || cl.id) === p.clientId);
                    return (
                      <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.6)", fontSize: 13 }}>{c?.name?.split(" ")[0] || p.clientId}</td>
                        <td style={{ padding: "10px 12px", color: "#fff", fontSize: 13 }}>{p.description}</td>
                        <td style={{ padding: "10px 12px", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{fmt(p.date)}</td>
                        <td style={{ padding: "10px 12px", color: "#E8C87A", fontWeight: 600 }}>{fmtUSD(p.amount)}</td>
                        <td style={{ padding: "10px 12px" }}>
                          {p.status === "confirmed"      && <span style={{ color: "#10B981", fontSize: 12 }}>✓ Confirmado</span>}
                          {p.status === "rejected"       && <span style={{ color: "#EF4444", fontSize: 12 }}>✗ Rejeitado</span>}
                          {p.status === "pending_review" && <span style={{ color: "#F59E0B", fontSize: 12 }}>⏳ Em revisão</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </Card>
      </div>
    </div>
  );
}

function AdminCasesReport({ clients }) {
  // Simulação de status — em produção viria do Firestore
  const SAMPLE_STATUSES = [
    { stage: "PERM",                status: "analyst_review" },
    { stage: "I-140",               status: "pending" },
    { stage: "Ajuste de Status",    status: "pending" },
    { stage: "Green Card",          status: "pending" },
  ];

  const statusCounts = {};
  Object.keys(STATUS_CONFIG).forEach(k => { statusCounts[k] = 0; });
  clients.forEach(() => SAMPLE_STATUSES.forEach(s => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; }));

  const donutData = Object.entries(statusCounts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ label: STATUS_CONFIG[k]?.label || k, value: v, color: STATUS_CONFIG[k]?.color || "#888" }));

  const printHTML = `
    <h2>Resumo de Status</h2>
    <table><tr><th>Status</th><th>Qtd</th></tr>
      ${Object.entries(statusCounts).filter(([,v])=>v>0).map(([k,v]) => `<tr><td>${STATUS_CONFIG[k]?.label||k}</td><td>${v}</td></tr>`).join("")}
    </table>
    <h2>Detalhe por Cliente</h2>
    <table><tr><th>Cliente</th><th>Processo</th><th>Sponsor</th><th>Etapa Atual</th><th>Status</th><th>Priority Date</th></tr>
      ${clients.map(c => `<tr><td>${c.name}</td><td>${c.caseType||"EB-3"}</td><td>${c.sponsor||"—"}</td><td>PERM</td><td><span class="badge yellow">Em Análise</span></td><td>${fmt(c.priorityDate)}</td></tr>`).join("")}
    </table>
  `;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ color: "#E8C87A", margin: 0 }}>Relatório de Status dos Casos</h3>
        <Btn variant="ghost" onClick={() => printReport("admin-cases-report", "Relatório de Status dos Casos")}>🖨 Imprimir / PDF</Btn>
      </div>

      <div id="admin-cases-report" data-print-html={printHTML}>
        {/* Donut */}
        <Card>
          <h4 style={{ color: "#E8C87A", margin: "0 0 20px" }}>Distribuição de Status</h4>
          {donutData.length > 0
            ? <DonutChart segments={donutData} />
            : <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Nenhum dado disponível.</div>
          }
        </Card>

        {/* Tabela por cliente */}
        <Card>
          <h4 style={{ color: "#E8C87A", margin: "0 0 16px" }}>Detalhe por Cliente</h4>
          {clients.length === 0
            ? <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: 20 }}>Nenhum cliente cadastrado.</div>
            : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Cliente", "Processo", "Sponsor", "Etapa Atual", "Status", "Priority Date"].map(h => (
                    <th key={h} style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "11px 12px", color: "#fff", fontSize: 13, fontWeight: 600 }}>{c.name}</td>
                      <td style={{ padding: "11px 12px", color: "#E8C87A", fontSize: 13 }}>{c.caseType || "EB-3"}</td>
                      <td style={{ padding: "11px 12px", color: "rgba(255,255,255,0.5)", fontSize: 12 }}>{c.sponsor || "—"}</td>
                      <td style={{ padding: "11px 12px", color: "#fff", fontSize: 13 }}>PERM</td>
                      <td style={{ padding: "11px 12px" }}><Badge status="analyst_review" /></td>
                      <td style={{ padding: "11px 12px", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{fmt(c.priorityDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Card>

        {/* Alertas */}
        <Card>
          <h4 style={{ color: "#E8C87A", margin: "0 0 16px" }}>Alertas e Próximos Passos</h4>
          {clients.length === 0
            ? <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Nenhum cliente.</div>
            : clients.map(c => (
              <div key={c.id} style={{ padding: "12px 16px", background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, marginBottom: 10 }}>
                <div style={{ color: "#F59E0B", fontWeight: 600, fontSize: 13 }}>⏳ {c.name?.split(" ")[0]} — PERM em análise</div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: 4 }}>
                  Submetido em {fmt(c.priorityDate)} · Previsão de aprovação: Set/Out 2026 · Acompanhe em flag.dol.gov
                </div>
              </div>
            ))
          }
        </Card>
      </div>
    </div>
  );
}

function AdminTypesReport({ clients }) {
  // Contagem por tipo de processo
  const typeCounts = {};
  clients.forEach(c => {
    const t = c.caseType || "EB-3";
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  });

  // Contagem por país (baseado no sponsor ou campo country futuro)
  const byCountry = { "Brasil": clients.length }; // placeholder

  const typeColors = ["#E8C87A", "#60A5FA", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444"];

  const donutSegs = Object.entries(typeCounts).map(([k, v], i) => ({
    label: k, value: v, color: typeColors[i % typeColors.length],
  }));

  const printHTML = `
    <h2>Distribuição por Tipo de Processo</h2>
    <table><tr><th>Tipo</th><th>Qtd</th><th>%</th></tr>
      ${Object.entries(typeCounts).map(([k,v]) => `<tr><td>${k}</td><td>${v}</td><td>${Math.round((v/clients.length)*100)}%</td></tr>`).join("")}
    </table>
    <h2>Lista de Clientes por Processo</h2>
    <table><tr><th>Cliente</th><th>Tipo</th><th>Sponsor</th><th>Priority Date</th><th>Email</th></tr>
      ${clients.map(c => `<tr><td>${c.name}</td><td>${c.caseType||"EB-3"}</td><td>${c.sponsor||"—"}</td><td>${fmt(c.priorityDate)}</td><td>${c.email}</td></tr>`).join("")}
    </table>
  `;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ color: "#E8C87A", margin: 0 }}>Relatório por Tipo de Processo</h3>
        <Btn variant="ghost" onClick={() => printReport("admin-types-report", "Relatório por Tipo de Processo")}>🖨 Imprimir / PDF</Btn>
      </div>

      <div id="admin-types-report" data-print-html={printHTML}>
        {/* Donut tipos */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <Card>
            <h4 style={{ color: "#E8C87A", margin: "0 0 20px" }}>Por Tipo de Processo</h4>
            {donutSegs.length > 0
              ? <DonutChart segments={donutSegs} />
              : <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Nenhum dado.</div>
            }
          </Card>

          <Card>
            <h4 style={{ color: "#E8C87A", margin: "0 0 20px" }}>Resumo Quantitativo</h4>
            {Object.entries(typeCounts).map(([tipo, qtd], i) => (
              <div key={tipo} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: typeColors[i % typeColors.length] }} />
                  <span style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{tipo}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: typeColors[i % typeColors.length], fontSize: 22, fontWeight: 700 }}>{qtd}</div>
                  <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>{Math.round((qtd / clients.length) * 100)}% dos clientes</div>
                </div>
              </div>
            ))}
            {Object.keys(typeCounts).length === 0 && (
              <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, textAlign: "center", padding: 20 }}>Nenhum cliente cadastrado.</div>
            )}
          </Card>
        </div>

        {/* Tabela detalhada */}
        <Card>
          <h4 style={{ color: "#E8C87A", margin: "0 0 16px" }}>Lista Completa por Processo</h4>
          {clients.length === 0
            ? <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: 20 }}>Nenhum cliente cadastrado.</div>
            : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Cliente", "Tipo", "Sponsor", "Priority Date", "E-mail"].map(h => (
                    <th key={h} style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", padding: "8px 12px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {clients.map(c => (
                    <tr key={c.id} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "11px 12px", color: "#fff", fontWeight: 600, fontSize: 13 }}>{c.name}</td>
                      <td style={{ padding: "11px 12px" }}>
                        <span style={{ padding: "3px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600, background: "rgba(200,169,110,0.12)", color: "#E8C87A" }}>{c.caseType || "EB-3"}</span>
                      </td>
                      <td style={{ padding: "11px 12px", color: "rgba(255,255,255,0.5)", fontSize: 13 }}>{c.sponsor || "—"}</td>
                      <td style={{ padding: "11px 12px", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{fmt(c.priorityDate)}</td>
                      <td style={{ padding: "11px 12px", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>{c.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </Card>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORTS ROUTER
// ─────────────────────────────────────────────────────────────────────────────
function ReportsView({ user, payments, clients }) {
  if (user.role === "admin") return <AdminReports clients={clients} payments={payments} />;
  return <ClientReports user={user} payments={payments} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROTOCOL SITES CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const PROTOCOL_SITES = [
  { id: "perm",  label: "PERM (DOL)",   placeholder: "Ex: G-200-26086-734717", url: "https://flag.dol.gov/case-status-search" },
  { id: "i140",  label: "I-140 (USCIS)", placeholder: "Ex: IOE0123456789",      url: "https://egov.uscis.gov/casestatus/landing.do" },
  { id: "i485",  label: "I-485 (USCIS)", placeholder: "Ex: MSC2190000000",      url: "https://egov.uscis.gov/casestatus/landing.do" },
  { id: "nvc",   label: "NVC",           placeholder: "Ex: MIA2025000000",      url: "https://ceac.state.gov/IV/" },
];

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS VIEW (admin only)
// ─────────────────────────────────────────────────────────────────────────────
function ClientsView({ clients, setClients }) {
  const [expandedId, setExpandedId] = useState(null);
  const [editingId,  setEditingId]  = useState(null);
  const [protocols,  setProtocols]  = useState({});   // { [clientId]: { perm: "...", i140: "...", ... } }
  const [saving,     setSaving]     = useState(false);

  // Inicializar protocolos dos clientes
  useEffect(() => {
    const init = {};
    clients.forEach(c => {
      const cid = c.clientId || c.id;
      init[cid] = { perm: "", i140: "", i485: "", nvc: "", ...(c.protocols || {}) };
    });
    setProtocols(init);
  }, [clients]);

  const startEdit = (c) => {
    const cid = c.clientId || c.id;
    setEditingId(cid);
    setExpandedId(cid);
  };

  const saveProtocols = async (c) => {
    const cid = c.clientId || c.id;
    setSaving(true);
    try {
      await firestoreUpdate("users", c.id, { protocols: protocols[cid] });
      setClients(prev => prev.map(cl => (cl.clientId || cl.id) === cid ? { ...cl, protocols: protocols[cid] } : cl));
      setEditingId(null);
    } finally { setSaving(false); }
  };

  const hasAnyProtocol = (c) => {
    const cid = c.clientId || c.id;
    const p = protocols[cid] || c.protocols || {};
    return PROTOCOL_SITES.some(s => p[s.id]);
  };

  if (clients.length === 0) return (
    <Card>
      <div style={{ color: "rgba(255,255,255,0.3)", textAlign: "center", padding: 40 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>👥</div>
        Nenhum cliente cadastrado ainda.<br />
        <span style={{ fontSize: 12, marginTop: 6, display: "block" }}>Crie os usuários no Firebase Console e defina role: "client".</span>
      </div>
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {clients.map(c => {
        const cid       = c.clientId || c.id;
        const isOpen    = expandedId === cid;
        const isEditing = editingId  === cid;
        const cProtos   = protocols[cid] || {};

        return (
          <Card key={c.id} style={{ padding: 0, overflow: "hidden" }}>
            {/* ── Cabeçalho do cliente ── */}
            <div style={{ padding: "18px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ color: "#fff", fontWeight: 700, fontSize: 16 }}>{c.name}</div>
                  <span style={{ padding: "2px 10px", borderRadius: 99, background: "rgba(200,169,110,0.12)", color: "#E8C87A", fontSize: 11, fontWeight: 600 }}>Ativo</span>
                  {hasAnyProtocol(c) && (
                    <span style={{ padding: "2px 10px", borderRadius: 99, background: "rgba(96,165,250,0.12)", color: "#60A5FA", fontSize: 11, fontWeight: 600 }}>
                      🔢 Protocolo cadastrado
                    </span>
                  )}
                </div>
                <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, marginTop: 3 }}>{c.email}</div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginTop: 3 }}>
                  {c.caseType} · Sponsor: {c.sponsor} · Priority: {fmt(c.priorityDate)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn variant="ghost" style={{ padding: "6px 14px", fontSize: 12 }} onClick={() => startEdit(c)}>
                  ✏️ Protocolos
                </Btn>
                <button onClick={() => setExpandedId(isOpen ? null : cid)}
                  style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: 18, padding: "0 4px", transition: "transform 0.2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>
                  ▾
                </button>
              </div>
            </div>

            {/* ── Painel expandido de protocolos ── */}
            {isOpen && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "18px 20px", background: "rgba(0,0,0,0.2)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <h4 style={{ color: "#E8C87A", margin: 0, fontSize: 14 }}>Números de Protocolo</h4>
                  {!isEditing && (
                    <Btn variant="ghost" style={{ padding: "5px 14px", fontSize: 12 }} onClick={() => setEditingId(cid)}>Editar</Btn>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {PROTOCOL_SITES.map(site => {
                    const val = cProtos[site.id] || "";
                    return (
                      <div key={site.id} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "14px 16px" }}>
                        <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                          {site.label}
                        </div>
                        {isEditing ? (
                          <input
                            value={cProtos[site.id] || ""}
                            onChange={e => setProtocols(prev => ({ ...prev, [cid]: { ...prev[cid], [site.id]: e.target.value } }))}
                            placeholder={site.placeholder}
                            style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#fff", fontSize: 13, boxSizing: "border-box", fontFamily: "inherit" }}
                          />
                        ) : val ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <code style={{ color: "#E8C87A", fontSize: 13, fontFamily: "monospace", background: "rgba(200,169,110,0.08)", padding: "4px 8px", borderRadius: 6 }}>{val}</code>
                            <a href={site.url} target="_blank" rel="noreferrer"
                              style={{ color: "#60A5FA", fontSize: 11, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
                              🔗 Verificar
                            </a>
                          </div>
                        ) : (
                          <span style={{ color: "rgba(255,255,255,0.2)", fontSize: 13, fontStyle: "italic" }}>Não cadastrado</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {isEditing && (
                  <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                    <Btn onClick={() => saveProtocols(c)} disabled={saving}>{saving ? "Salvando…" : "Salvar Protocolos"}</Btn>
                    <Btn variant="ghost" onClick={() => { setEditingId(null); }}>Cancelar</Btn>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// APP ROOT
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [user,       setUser]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [active,     setActive]     = useState("dashboard");
  const [messages,   setMessages]   = useState([]);
  const [payments,   setPayments]   = useState([]);
  const [caseStatus, setCaseStatus] = useState([]);
  const [clients,    setClients]    = useState([]);

  // Verificar sessão existente ao montar
  useEffect(() => {
    loadFirebase().then(() => {
      auth.onAuthStateChanged(auth.instance, async (fbUser) => {
        if (fbUser) {
          const doc = await firestoreGet("users", fbUser.uid);
          if (doc) setUser({ uid: fbUser.uid, ...doc });
        }
        setLoading(false);
      });
    });
  }, []);

  // Carregar dados quando user logado
  useEffect(() => {
    if (!user || !db) return;
    const isAdmin = user.role === "admin";
    const clientId = user.clientId || user.id;

    // Real-time listeners
    const unsubs = [];

    if (isAdmin) {
      unsubs.push(firestoreListen("messages", setMessages));
      unsubs.push(firestoreListen("payments", setPayments));
      firestoreList("users", db.where("role", "==", "client")).then(setClients);
    } else {
      unsubs.push(firestoreListen("messages", setMessages, db.where("clientId", "==", clientId)));
      unsubs.push(firestoreListen("payments", setPayments, db.where("clientId", "==", clientId)));
      firestoreGet("caseStatus", clientId).then(data => { if (data) setCaseStatus(data.stages || []); });
    }

    return () => unsubs.forEach(u => u());
  }, [user]);

  const logout = async () => {
    await loadFirebase();
    await auth.signOut(auth.instance);
    setUser(null); setMessages([]); setPayments([]); setCaseStatus([]); setClients([]);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0A0F1E", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Spinner />
    </div>
  );

  if (!user) return <LoginScreen onLogin={u => { setUser(u); setActive("dashboard"); }} />;

  const isAdmin = user.role === "admin";

  const renderView = () => {
    switch (active) {
      case "dashboard": return <Dashboard user={user} messages={messages} payments={payments} caseStatus={caseStatus} />;
      case "messages":  return <MessagesView user={user} messages={messages} setMessages={setMessages} clients={clients} />;
      case "payments":  return <PaymentsView user={user} payments={payments} setPayments={setPayments} />;
      case "cases":     return <CasesView user={user} caseStatus={caseStatus} setCaseStatus={setCaseStatus} clientData={clients[0]} />;
      case "bulletin":  return <BulletinView user={user} />;
      case "clients":   return <ClientsView clients={clients} setClients={setClients} />;
      case "reports":   return <ReportsView user={user} payments={payments} clients={clients} />;
      default: return null;
    }
  };

  const pageTitle = {
    dashboard: isAdmin ? "Dashboard" : `Olá, ${user.name?.split(" ")[0]} 👋`,
    messages:  "Mensagens",
    payments:  "Financeiro",
    cases:     isAdmin ? "Processos" : "Meu Processo",
    bulletin:  "Visa Bulletin",
    clients:   "Clientes",
    reports:   "Relatórios",
  }[active];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "#0D1117", fontFamily: "'Georgia','Times New Roman',serif", color: "#fff" }}>
      <Sidebar user={user} active={active} setActive={setActive} onLogout={logout} />
      <main style={{ flex: 1, padding: 32, overflowY: "auto" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <div style={{ marginBottom: 28 }}>
            <h2 style={{ color: "#fff", margin: 0, fontSize: 22, fontWeight: 700 }}>{pageTitle}</h2>
            <p style={{ color: "rgba(255,255,255,0.3)", margin: "4px 0 0", fontSize: 13 }}>
              {new Date().toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>
          {renderView()}
        </div>
      </main>
    </div>
  );
}
