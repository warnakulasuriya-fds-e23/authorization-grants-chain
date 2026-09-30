# Authorization Grants Chain

A lightweight proof of concept that stores **official authorizations on a permissioned blockchain**: which official granted which authority to whom, and when that authority was checked. It's a demo of the idea, not a production system.

## What it is

- **Officials** hold authorities such as *Vehicle search* or *Premises entry*. **Super officials** hold the `ADMIN` authority and can grant or revoke authorities for other officials, including `ADMIN` itself, so authority can be delegated.
- **Verifiers** (a citizen, or a company's front desk) can check an official on the spot. The verifier shows a **QR code**, the official scans it and **consents**, and the verifier gets the official's identity plus on-chain proof of the authority, traced back to the root.
- Every `GRANT`, `REVOKE` and consented `VERIFY` is a transaction mined into a block. Each chain node enforces the rules itself: a grant is rejected unless the grantor holds `ADMIN` at that point in the chain.
- Only **user ids** go on chain. Names, credentials and badge numbers stay off-chain in PostgreSQL.

## Inspiration

This project draws on the winning idea from the [EUDI Wallet hackathon](https://thunderid.dev/blog/eudi-wallet-hackathon/), which verified that officials such as police officers hold the prior authorization a task legally requires. This PoC is a simpler version: no EUDI Wallet and no ThunderID, just the claim that the authorizations themselves can live on a shared ledger.

## Why it could be useful

- **Shared source of truth.** Each department (police, customs, courts) runs its own node and keeps a full copy, so no single party owns the record. The same model fits an international conglomerate, with a private chain replicated across branches in different countries.
- **Meaningful audits.** There's a tamper-evident trail of who gave permission to whom, for what, and when it was used. Changing any past block breaks every hash after it.
- **Instant checks.** A verifier can confirm an official's authority in seconds, with the official's consent.

## Architecture

```
          ┌──────────── web (React + Vite + Tailwind, nginx) :8090
          │  /api
          ▼
   api (Go) ── PostgreSQL        users, credentials, verification requests
     │   round-robin writes, failover
     ▼
   node1 (Go) ◀── gossip / sync ──▶ node2 (Go)     full chain replicas :8081 / :8082
```

| Component | Description | API spec |
|---|---|---|
| [`chain-node/`](chain-node) | Ledger replica: light proof-of-work, rule validation, block gossip, longest-chain sync with fork resolution, persisted to a volume. Standard library only. | [openapi.yaml](chain-node/openapi.yaml) |
| [`api/`](api) | Gateway: login (JWT), user directory, QR verification flow, grants. | [openapi.yaml](api/openapi.yaml) |
| [`web/`](web) | Dashboards for officials and verifiers, a QR scanner, and a horizontally scrolling block explorer. | – |

## Setup

Requires Docker with Compose.

```bash
docker compose up --build
```

Open **http://localhost:8090**. The port can be changed with `WEB_PORT=9000 docker compose up`.

All demo accounts use the password **`demo1234`**, and the login screen has one-click buttons for each.

| User | Role |
|---|---|
| `chief` | Super official: root `ADMIN` from the genesis block |
| `director` | Super official: `ADMIN` delegated by `chief` |
| `silva`, `bandara` | Officials with seeded authorities |
| `fernando` | Official with no authorities yet |
| `citizen`, `frontdesk` | Verifiers |

To reset everything: `docker compose down -v`.

## Demo script

1. **Verify:** Log in as `citizen`, pick *Vehicle search*, and generate a QR code. In another browser window (or a private window), log in as `silva`, open **Scan QR**, and scan the code or type it in. Consent, and the citizen's screen switches to *Authorized* with the proof.
2. **Unauthorized:** Repeat the steps as `fernando`. The verifier sees *Not authorized*.
3. **Grant:** Log in as `chief` and grant `fernando` *Vehicle search*, then repeat step 2. Revoke it again from the registry.
4. **Explorer:** Open **Explorer**. Each block links to the next through its hash. Switch between `node1` and `node2`, and click **Verify integrity** to recompute every hash in the browser.
5. **Replication:** Run `docker compose stop node2`, make a grant, then run `docker compose start node2`. node2 catches up within a few seconds.

The camera only works on `localhost` or over HTTPS. On other devices, type in the 8-character code.

## Local development

```bash
docker compose up -d                 # backend stack
cd web && npm install && npm run dev # UI on :5173, proxies /api to :8090
```

## Limitations (it's a PoC)

- Consensus is proof-of-work with longest-chain sync. A real deployment would use a permissioned BFT/PoA protocol with node identities.
- Transactions are authorized by the gateway's login, not signed by each official's own key.
- Demo secrets are hard-coded in `docker-compose.yml`.
