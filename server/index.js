import express from "express";
import cors from "cors";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

// ---- In-memory stores (simulating ephemeral, non-persistent state) ----
// Active hotel "location beacons" (simulated NFC/WiFi/Bluetooth presence tokens)
const locationBeacons = new Map(); // locationToken -> { hotelName, createdAt, expiresAt }

// Burned intent hashes (so a proof can NEVER be replayed, even if intercepted)
const burnedHashes = new Set();

// Proofs that have been generated but not yet verified (ephemeral, short TTL)
const pendingProofs = new Map(); // proofId -> proof object

const LOCATION_TTL_MS = 2 * 60 * 1000; // beacon valid for 2 minutes
const PROOF_TTL_MS = 60 * 1000; // proof valid for 60 seconds

function hash(data) {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

function cleanup() {
  const now = Date.now();
  for (const [k, v] of locationBeacons) if (v.expiresAt < now) locationBeacons.delete(k);
  for (const [k, v] of pendingProofs) if (v.expiresAt < now) pendingProofs.delete(k);
}

// ---------------------------------------------------------------------
// STEP A: Hotel terminal broadcasts a location beacon
// (simulates NFC tap point / Bluetooth beacon / WiFi router proof-of-presence)
// ---------------------------------------------------------------------
app.post("/api/beacon", (req, res) => {
  cleanup();
  const { hotelName, room } = req.body;
  const locationToken = crypto.randomBytes(8).toString("hex");
  locationBeacons.set(locationToken, {
    hotelName: hotelName || "Sakura Hotel Tokyo",
    room: room || "404",
    createdAt: Date.now(),
    expiresAt: Date.now() + LOCATION_TTL_MS,
  });
  res.json({ locationToken, expiresIn: LOCATION_TTL_MS });
});

// ---------------------------------------------------------------------
// STEP B: Wallet "taps" the beacon and generates a Zero-Knowledge Proof
// bound to (credential claim + location + one-time intent)
// ---------------------------------------------------------------------
app.post("/api/generate-proof", (req, res) => {
  cleanup();
  const { locationToken, credential, intent } = req.body;

  const beacon = locationBeacons.get(locationToken);
  if (!beacon) {
    return res.status(400).json({ error: "Invalid or expired location token. Tap the beacon again." });
  }

  // Simulated ZKP: prove possession of credential claims WITHOUT revealing
  // name, passport number, address etc. Only the claim + a random nonce.
  const nonce = crypto.randomBytes(16).toString("hex");
  const claim = {
    issuer: credential.issuer,       // e.g. "EU-eIDAS-2.0"
    country: credential.country,     // e.g. "EU"
    ageOver: credential.ageOver,     // e.g. 18
  };
  const zkpHash = hash({ claim, nonce });

  // Intent-binding: this exact intent, at this exact location, can only be used once.
  const intentHash = hash({ intent, locationToken, nonce, ts: Date.now() });

  const proofId = crypto.randomBytes(8).toString("hex");
  const proof = {
    proofId,
    zkpHash,
    intentHash,
    locationToken,
    claim,
    intent,
    expiresAt: Date.now() + PROOF_TTL_MS,
  };
  pendingProofs.set(proofId, proof);

  // What gets transmitted to the hotel — a compact "proof code"
  const proofCode = Buffer.from(
    JSON.stringify({ proofId, zkpHash, intentHash, locationToken })
  ).toString("base64");

  res.json({ proofCode, claim, intent, expiresIn: PROOF_TTL_MS });
});

// ---------------------------------------------------------------------
// STEP C: Hotel terminal verifies the proof code.
// On success: returns a verdict ONLY ("VALID, age>18, expired") — no PII.
// The proof is then permanently burned and CANNOT be reused.
// ---------------------------------------------------------------------
app.post("/api/verify", (req, res) => {
  cleanup();
  const { proofCode, locationToken } = req.body;

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(proofCode, "base64").toString("utf-8"));
  } catch (e) {
    return res.status(400).json({ valid: false, status: "MALFORMED" });
  }

  const { proofId, zkpHash, intentHash, locationToken: proofLocation } = decoded;

  // 1. Already used? -> proof was destroyed after first use
  if (burnedHashes.has(intentHash)) {
    return res.json({
      valid: false,
      status: "PROOF_ALREADY_DESTROYED",
      message: "This proof was already consumed and cannot be reused.",
    });
  }

  // 2. Does the proof still exist (not expired / not previously burned)?
  const proof = pendingProofs.get(proofId);
  if (!proof) {
    return res.json({
      valid: false,
      status: "EXPIRED_OR_UNKNOWN",
      message: "Proof not found — it may have expired or never existed.",
    });
  }

  // 3. Location-binding check: must match the SAME beacon this hotel terminal issued
  if (proofLocation !== locationToken || proof.locationToken !== locationToken) {
    return res.json({
      valid: false,
      status: "LOCATION_MISMATCH",
      message: "Proof was not generated at this location.",
    });
  }

  // 4. Integrity check on the ZKP hash
  if (proof.zkpHash !== zkpHash || proof.intentHash !== intentHash) {
    return res.json({ valid: false, status: "INVALID_PROOF" });
  }

  // ---- All checks passed: produce the ephemeral verdict ----
  const verdict = {
    valid: true,
    status: "VALID_THEN_EXPIRED",
    claim: {
      issuer: proof.claim.issuer,
      country: proof.claim.country,
      ageOver: proof.claim.ageOver,
    },
    intent: proof.intent,
    message: `VALID: ${proof.claim.country} ID. Age > ${proof.claim.ageOver}. Present at location. Proof EXPIRED.`,
  };

  // BURN: permanently destroy the proof so it can never be replayed
  burnedHashes.add(intentHash);
  pendingProofs.delete(proofId);
  locationBeacons.delete(locationToken); // location token also single-use per check-in

  res.json(verdict);
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`ETO backend running on http://localhost:${PORT}`));
