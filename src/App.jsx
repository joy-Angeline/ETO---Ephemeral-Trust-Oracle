import { useState, useRef } from "react";

const API = "https://eto-ephemeral-trust-oracle.onrender.com";

const MOCK_CREDENTIAL = {
  issuer: "EU-eIDAS-2.0",
  country: "EU",
  ageOver: 18,
};

function now() {
  const d = new Date();
  return d.toLocaleTimeString("en-GB", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export default function App() {
  const [log, setLog] = useState([]);

  // Hotel state
  const [beacon, setBeacon] = useState(null); // { locationToken, expiresIn }
  const [verdict, setVerdict] = useState(null);
  const [unlocked, setUnlocked] = useState(false);

  // Wallet state
  const [proof, setProof] = useState(null); // { proofCode, claim, intent }
  const [intent, setIntent] = useState("Room 404 check-in");
  const [burned, setBurned] = useState(false);
  const [sent, setSent] = useState(false);

  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const pulseRef = useRef(null);

  function pushLog(type, msg) {
    setLog((l) => [...l, { type, msg, t: now() }].slice(-30));
  }

  async function broadcastBeacon() {
    setLoadingA(true);
    try {
      const res = await fetch(`${API}/beacon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hotelName: "Sakura Hotel Tokyo", room: "404" }),
      });
      const data = await res.json();
      setBeacon(data);
      pushLog("ok", `Hotel beacon broadcast → location token ${data.locationToken.slice(0, 8)}… (no GPS, no log of past taps)`);
    } catch (e) {
      pushLog("err", `Beacon error: ${e.message}. Is the backend running on :4000?`);
    } finally {
      setLoadingA(false);
    }
  }

  async function generateProof() {
    if (!beacon) {
      pushLog("err", "Wallet: no beacon detected. Ask the hotel to broadcast first (tap NFC).");
      return;
    }
    setLoadingB(true);
    try {
      const res = await fetch(`${API}/generate-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationToken: beacon.locationToken,
          credential: MOCK_CREDENTIAL,
          intent,
        }),
      });
      const data = await res.json();
      if (data.error) {
        pushLog("err", `Wallet: ${data.error}`);
        return;
      }
      setProof(data);
      setBurned(false);
      setSent(false);
      setVerdict(null);
      setUnlocked(false);
      pushLog("ok", "Wallet: ZKP generated — proves age>18 & EU issuer, location-bound, intent-bound. Name/passport NOT included.");
    } catch (e) {
      pushLog("err", `Proof error: ${e.message}`);
    } finally {
      setLoadingB(false);
    }
  }

  function sendToHotel() {
    if (!proof) return;
    setSent(true);
    pushLog("ok", "Wallet → Hotel: proof transmitted over NFC tap (physical proximity only)");
  }

  async function verifyProof() {
    if (!proof || !sent) {
      pushLog("err", "Hotel: no proof received yet.");
      return;
    }
    try {
      const res = await fetch(`${API}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofCode: proof.proofCode, locationToken: beacon.locationToken }),
      });
      const data = await res.json();
      setVerdict(data);
      if (data.valid) {
        setUnlocked(true);
        setBurned(true);
        pushLog("ok", `Hotel: ${data.message}`);
        pushLog("ok", "Server: intent hash burned permanently. Location token retired. No PII ever stored.");
      } else {
        pushLog("err", `Hotel: ${data.status} — ${data.message || "verification failed"}`);
      }
    } catch (e) {
      pushLog("err", `Verify error: ${e.message}`);
    }
  }

  async function replayProof() {
    if (!proof) return;
    try {
      const res = await fetch(`${API}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofCode: proof.proofCode, locationToken: beacon?.locationToken || "" }),
      });
      const data = await res.json();
      pushLog("err", `Replay attempt → ${data.status}: ${data.message}`);
    } catch (e) {
      pushLog("err", `Replay error: ${e.message}`);
    }
  }

  function reset() {
    setBeacon(null);
    setProof(null);
    setVerdict(null);
    setUnlocked(false);
    setBurned(false);
    setSent(false);
    setLog([]);
  }

  return (
    <div className="app">
      <header className="header">
        <span className="eyebrow">Nexus · Ephemeral Trust Oracle (ETO)</span>
        <h1>Prove who you are, where you are, right now — then watch the proof vanish.</h1>
        <p>
          A cross-border identity bridge. The EU wallet generates a zero-knowledge proof bound to this
          exact location and this exact intent. The Japanese hotel learns only the verdict — then the
          proof is burned forever. No name. No tracking. No replay.
        </p>
      </header>

      <div className="stage">
        {/* WALLET PANEL */}
        <section className="panel">
          <div className="panel-head">
            <h2>EU Wallet</h2>
            <span className="tag eu">Traveler · device</span>
          </div>
          <p className="panel-sub">Holds a verifiable credential. Never reveals it directly.</p>

          <div className="cred-card">
            <div className="cred-row"><span className="k">Issuer</span><span className="v">{MOCK_CREDENTIAL.issuer}</span></div>
            <div className="cred-row"><span className="k">Country</span><span className="v">{MOCK_CREDENTIAL.country}</span></div>
            <div className="cred-row"><span className="k">Age claim</span><span className="v">over {MOCK_CREDENTIAL.ageOver}</span></div>
            <div className="cred-row"><span className="k">Name</span><span className="redacted">█████████</span></div>
            <div className="cred-row"><span className="k">Passport No.</span><span className="redacted">█████████</span></div>
            <div className="cred-row"><span className="k">Address</span><span className="redacted">█████████</span></div>
          </div>

          <div className="field">
            <label>One-time intent</label>
            <input value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="e.g. Room 404 check-in" />
          </div>

          <button className="btn primary" onClick={generateProof} disabled={loadingB || !beacon}>
            {beacon ? "Tap beacon → generate ZK proof" : "Waiting for hotel beacon…"}
          </button>

          {proof && (
            <>
              <div className="field">
                <label>Generated proof code (ZKP + intent hash, no PII)</label>
                <div className={`proof-code ${burned ? "burned dissolving" : ""}`}>
                  {proof.proofCode}
                </div>
              </div>
              <button className="btn" onClick={sendToHotel} disabled={sent || burned}>
                {sent ? "Sent via NFC ✓" : "Send proof to hotel (NFC tap)"}
              </button>
            </>
          )}
        </section>

        {/* BRIDGE */}
        <div className="bridge">
          <div className="bridge-line">
            <div ref={pulseRef} className={`bridge-pulse ${sent ? "active" : ""}`} />
          </div>
        </div>

        {/* HOTEL PANEL */}
        <section className="panel">
          <div className="panel-head">
            <h2>Hotel Terminal</h2>
            <span className="tag jp">Sakura Hotel · Tokyo, Room 404</span>
          </div>
          <p className="panel-sub">Verifies the proof. Stores nothing afterward.</p>

          <button className="btn" onClick={broadcastBeacon} disabled={loadingA || !!beacon}>
            {beacon ? "Beacon active ✓" : "Broadcast NFC / location beacon"}
          </button>

          {beacon && (
            <div className="field">
              <label>Location token (proves physical presence, 2 min TTL)</label>
              <div className="proof-code">{beacon.locationToken}</div>
            </div>
          )}

          <button className="btn primary" onClick={verifyProof} disabled={!sent || !!verdict}>
            Verify incoming proof
          </button>

          {verdict && (
            <div className={`verdict ${verdict.valid ? "valid" : "invalid"}`}>
              <span className="big">{verdict.valid ? "✓ VALID — THEN EXPIRED" : `✕ ${verdict.status}`}</span>
              {verdict.valid ? (
                <>
                  Issuer: {verdict.claim.issuer}<br />
                  Country: {verdict.claim.country}<br />
                  Age check: over {verdict.claim.ageOver} ✓<br />
                  Intent: {verdict.intent}<br />
                  Name / passport / address: never received<br />
                  Proof status: destroyed, cannot be reused
                </>
              ) : (
                verdict.message
              )}
            </div>
          )}

          <div className={`door ${unlocked ? "unlocked" : ""}`}>
            <span className="icon">{unlocked ? "🔓" : "🔒"}</span>
            <span className="status">{unlocked ? "Room 404 unlocked" : "Locked — awaiting valid proof"}</span>
          </div>

          {verdict?.valid && (
            <button className="btn danger" onClick={replayProof}>
              Attacker: try to replay this proof tomorrow
            </button>
          )}
        </section>
      </div>

      <div className="log">
        <h3>Protocol log — what actually crosses the wire</h3>
        <div className="log-entries">
          {log.length === 0 && <div className="log-entry"><span className="t">--:--:--</span><span className="msg">Waiting for the hotel to broadcast a beacon…</span></div>}
          {log.map((entry, i) => (
            <div key={i} className={`log-entry ${entry.type}`}>
              <span className="t">{entry.t}</span>
              <span className="msg">{entry.msg}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="reset-row">
        <button className="btn" onClick={reset}>Reset demo</button>
      </div>

      <p className="footer-note">
        Location-binding · Intent-binding · Ephemeral verdict — no storage, no linkable identifiers, no replay.
      </p>
    </div>
  );
}
