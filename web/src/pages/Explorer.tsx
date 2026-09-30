import { Blocks, ChevronsLeft, ChevronsRight, CircleCheck, Pickaxe, Server, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Button, Card, cx, fmtTime, HashChip, hashHue, nameOf, TxBadge } from "../components/ui";
import { scopeLabel, usePoll, useScopes, useUsers } from "../directory";
import type { Block, NodeStatus, Scope, Tx, User } from "../types";

// Card geometry is fixed so the connectors can join the exact hash rows.
const CARD_H = 288;
const CARD_W = 272;
const LINK_W = 96;
const PREV_Y = CARD_H - 54; // centre of the PREV row
const HASH_Y = CARD_H - 22; // centre of the HASH row

const minerTone: Record<string, string> = {
  node1: "bg-cyan-500/15 text-cyan-300 ring-cyan-400/30",
  node2: "bg-violet-500/15 text-violet-300 ring-violet-400/30",
  genesis: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
};

function describe(tx: Tx, users: Record<string, User>, scopes: Scope[]) {
  const a = nameOf(users, tx.actor);
  const s = nameOf(users, tx.subject);
  const scope = scopeLabel(scopes, tx.scope);
  if (tx.actor === "genesis") return <>Root authority <b>{scope}</b> → {s}</>;
  switch (tx.type) {
    case "GRANT":
      return <>{a} granted <b>{scope}</b> to {s}</>;
    case "REVOKE":
      return <>{a} revoked <b>{scope}</b> from {s}</>;
    case "VERIFY":
      return <>{a} proved <b>{scope}</b> to {s}</>;
  }
}

// --- in-browser integrity check (mirrors the Go hashing) -----------------------------

function goJSON(v: unknown) {
  // Go's encoding/json escapes these characters; match it byte for byte.
  return JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function checkChain(blocks: Block[]) {
  const bad = new Set<number>();
  for (const [i, b] of blocks.entries()) {
    const h = await sha256(`${b.index}|${b.timestamp}|${b.prevHash}|${b.nonce}|${b.miner}|${goJSON(b.transactions)}`);
    if (h !== b.hash || (i > 0 && b.prevHash !== blocks[i - 1].hash)) bad.add(b.index);
  }
  return bad;
}

// --- pieces ------------------------------------------------------------------------

function Connector({ hash }: { hash: string }) {
  const hue = hashHue(hash);
  const color = `hsl(${hue} 85% 62%)`;
  const mid = (PREV_Y + HASH_Y) / 2;
  const d = `M0 ${HASH_Y} C ${LINK_W / 2} ${HASH_Y}, ${LINK_W / 2} ${PREV_Y}, ${LINK_W} ${PREV_Y}`;
  return (
    <svg width={LINK_W} height={CARD_H} className="shrink-0 overflow-visible" aria-hidden>
      <title>The next block stores this block's hash as its prevHash</title>
      <path d={d} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={8} strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={2} className="chain-flow" />
      {/* two interlocking links */}
      <g transform={`translate(${LINK_W / 2} ${mid}) rotate(-12)`}>
        <rect x={-19} y={-7} width={22} height={14} rx={7} fill="#0b1224" stroke={color} strokeWidth={2.5} />
        <rect x={-3} y={-7} width={22} height={14} rx={7} fill="none" stroke={color} strokeWidth={2.5} />
      </g>
    </svg>
  );
}

function Port({ hash, side, y }: { hash: string; side: "left" | "right"; y: number }) {
  const c = `hsl(${hashHue(hash)} 85% 62%)`;
  return (
    <span
      className={cx("absolute size-3 -translate-y-1/2 rounded-full border-2 border-slate-950", side === "left" ? "-left-1.5" : "-right-1.5")}
      style={{ top: y, background: c, boxShadow: `0 0 10px ${c}` }}
    />
  );
}

function BlockCard({
  block,
  users,
  scopes,
  selected,
  invalid,
  animate,
  delay,
  onClick,
}: {
  block: Block;
  users: Record<string, User>;
  scopes: Scope[];
  selected: boolean;
  invalid?: boolean;
  animate: boolean;
  delay: number;
  onClick: () => void;
}) {
  const genesis = block.index === 0;
  const tx = block.transactions;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClick()}
      style={{ width: CARD_W, height: CARD_H, animationDelay: `${delay}ms` }}
      className={cx(
        "group relative shrink-0 cursor-pointer snap-center outline-none rounded-2xl border bg-gradient-to-b from-slate-900 to-slate-950 text-left shadow-xl shadow-black/40 transition",
        selected ? "border-cyan-400/60 ring-2 ring-cyan-400/25" : "border-white/10 hover:border-white/25",
        invalid && "border-rose-500/70 ring-2 ring-rose-500/30",
        animate && "block-in",
      )}
    >
      {!genesis && <Port hash={block.prevHash} side="left" y={PREV_Y} />}
      <Port hash={block.hash} side="right" y={HASH_Y} />

      <div className="flex items-start justify-between px-4 pt-4">
        <div>
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">{genesis ? "Genesis" : "Block"}</div>
          <div className="font-mono text-2xl font-semibold text-white">#{block.index}</div>
        </div>
        <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1", minerTone[block.miner])}>
          <Pickaxe className="size-3" /> {block.miner}
        </span>
      </div>
      <div className="px-4 text-[11px] text-slate-500">{fmtTime(block.timestamp)}</div>

      <div className="mt-3 space-y-2 px-4">
        {tx.slice(0, 2).map((t) => (
          <div key={t.id} className="rounded-lg bg-white/[0.04] p-2">
            <TxBadge type={t.actor === "genesis" ? "GENESIS" : t.type} />
            <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-300 [&_b]:font-medium [&_b]:text-white">
              {describe(t, users, scopes)}
            </p>
          </div>
        ))}
        {tx.length > 2 && <div className="text-[11px] text-slate-500">+{tx.length - 2} more</div>}
      </div>

      <div className="absolute inset-x-4 bottom-[70px] font-mono text-[10px] text-slate-600">nonce {block.nonce}</div>
      <div className="absolute inset-x-0 flex h-7 items-center border-t border-white/5 px-4" style={{ top: PREV_Y - 14 }}>
        <HashChip hash={block.prevHash} label="prev" />
      </div>
      <div className="absolute inset-x-0 flex h-7 items-center px-4" style={{ top: HASH_Y - 14 }}>
        <HashChip hash={block.hash} label="hash" />
      </div>
    </div>
  );
}

function PendingSlot() {
  return (
    <div
      style={{ width: CARD_W * 0.7, height: CARD_H }}
      className="grid shrink-0 place-items-center rounded-2xl border-2 border-dashed border-white/10 text-center text-xs text-slate-500"
    >
      <div className="space-y-2 px-4">
        <Blocks className="mx-auto size-6 text-slate-600" />
        Next block is mined when the next grant, revocation or verification happens
      </div>
    </div>
  );
}

function BlockDetail({ block, users, scopes }: { block: Block; users: Record<string, User>; scopes: Scope[] }) {
  const row = (k: string, v: React.ReactNode) => (
    <div className="grid gap-1 sm:grid-cols-[120px_1fr]">
      <dt className="text-xs uppercase tracking-wider text-slate-500">{k}</dt>
      <dd className="min-w-0 text-sm text-slate-200">{v}</dd>
    </div>
  );
  return (
    <Card className="p-5">
      <h3 className="mb-4 font-semibold text-white">Block #{block.index}</h3>
      <dl className="space-y-3">
        {row("Hash", <HashChip hash={block.hash} full />)}
        {row("Prev hash", <HashChip hash={block.prevHash} full />)}
        {row("Mined", `${fmtTime(block.timestamp)} by ${block.miner} · nonce ${block.nonce}`)}
      </dl>
      <div className="mt-5 space-y-3">
        {block.transactions.map((t) => (
          <div key={t.id} className="rounded-xl border border-white/5 bg-slate-950/50 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <TxBadge type={t.actor === "genesis" ? "GENESIS" : t.type} />
              <span className="text-sm text-slate-300 [&_b]:text-white">{describe(t, users, scopes)}</span>
            </div>
            <dl className="mt-3 space-y-2 font-mono text-xs">
              {(
                [
                  ["tx id", t.id],
                  ["actor", `${t.actor}  (${nameOf(users, t.actor)})`],
                  ["subject", `${t.subject}  (${nameOf(users, t.subject)})`],
                  ["scope", t.scope],
                  ["ref", t.ref],
                  ["note", t.note],
                  ["expires", t.expiresAt ? fmtTime(t.expiresAt) : undefined],
                ] as const
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="grid gap-1 sm:grid-cols-[80px_1fr]">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="break-all text-slate-300">{v}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>
    </Card>
  );
}

// --- page ---------------------------------------------------------------------------

export default function Explorer() {
  const { user } = useAuth();
  const users = useUsers(!!user);
  const scopes = useScopes();
  const [node, setNode] = useState("node1");
  const [selected, setSelected] = useState<number | null>(null);
  const [integrity, setIntegrity] = useState<{ bad: Set<number>; at: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const seen = useRef(-1);

  const nodes = usePoll(() => api<NodeStatus[]>("/chain/nodes"), 2000);
  const chain = usePoll(() => api<{ blocks: Block[] }>(`/chain/nodes/${node}/blocks`), 2000, [node]);
  const blocks = useMemo(() => chain.data?.blocks ?? [], [chain.data]);

  const online = nodes.data?.filter((n) => n.online) ?? [];
  const inSync = online.length > 1 && online.every((n) => n.tipHash === online[0].tipHash);

  // Scroll to the newest block on first load and whenever one arrives while near the end.
  const prevSeen = seen.current;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !blocks.length) return;
    const tip = blocks[blocks.length - 1].index;
    if (tip > seen.current) {
      const nearEnd = el.scrollWidth - el.scrollLeft - el.clientWidth < CARD_W * 2;
      if (seen.current === -1 || nearEnd) el.scrollTo({ left: el.scrollWidth, behavior: seen.current === -1 ? "auto" : "smooth" });
      seen.current = tip;
    }
  }, [blocks]);

  useEffect(() => {
    seen.current = -1;
    setIntegrity(null);
  }, [node]);

  // Vertical mouse wheel scrolls the chain sideways.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const scrollTo = (end: boolean) => scroller.current?.scrollTo({ left: end ? scroller.current.scrollWidth : 0, behavior: "smooth" });
  const selectedBlock = blocks.find((b) => b.index === selected);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Ledger explorer</h1>
          <p className="text-sm text-slate-400">
            Every authorization, revocation and consented verification — replicated on each node.
            {!user && " Log in to resolve user ids to names."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {online.length > 1 && (
            <span
              className={cx(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                inSync ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300",
              )}
            >
              <CircleCheck className="size-3.5" /> {inSync ? "Replicas in sync" : "Replicas syncing…"}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(nodes.data ?? [{ name: "node1", online: false }, { name: "node2", online: false }]).map((n) => (
          <button
            key={n.name}
            onClick={() => setNode(n.name)}
            className={cx(
              "flex cursor-pointer items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left transition",
              node === n.name ? "border-cyan-400/50 bg-cyan-400/5" : "border-white/10 bg-slate-900/60 hover:border-white/20",
            )}
          >
            <div className="flex items-center gap-3">
              <Server className={cx("size-5", n.name === "node1" ? "text-cyan-300" : "text-violet-300")} />
              <div>
                <div className="flex items-center gap-2 font-medium text-slate-100">
                  {n.name}
                  <span className={cx("size-2 rounded-full", n.online ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-rose-500")} />
                  {node === n.name && <span className="text-xs font-normal text-cyan-300">viewing</span>}
                </div>
                <div className="text-xs text-slate-400">
                  {n.online ? `${n.length} blocks · difficulty ${n.difficulty}` : "offline"}
                </div>
              </div>
            </div>
            {n.tipHash && (
              <div className="min-w-0 max-w-[50%]">
                <HashChip hash={n.tipHash} label="tip" />
              </div>
            )}
          </button>
        ))}
      </div>

      <Card className="relative">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
          <div className="text-sm text-slate-400">
            <span className="font-mono text-slate-200">{blocks.length}</span> blocks on {node}
            {chain.error && <span className="ml-2 text-rose-300">· {node} unreachable</span>}
          </div>
          <div className="flex items-center gap-2">
            {integrity && (
              <span className={cx("inline-flex items-center gap-1.5 text-xs", integrity.bad.size ? "text-rose-300" : "text-emerald-300")}>
                {integrity.bad.size ? <ShieldX className="size-4" /> : <ShieldCheck className="size-4" />}
                {integrity.bad.size ? `${integrity.bad.size} block(s) fail verification` : `All ${integrity.at} hashes & links verified in your browser`}
              </span>
            )}
            <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={async () => setIntegrity({ bad: await checkChain(blocks), at: blocks.length })}>
              <ShieldCheck className="size-3.5" /> Verify integrity
            </Button>
            <Button variant="ghost" className="px-2 py-1.5" onClick={() => scrollTo(false)} title="Genesis">
              <ChevronsLeft className="size-4" />
            </Button>
            <Button variant="ghost" className="px-2 py-1.5" onClick={() => scrollTo(true)} title="Latest">
              <ChevronsRight className="size-4" />
            </Button>
          </div>
        </div>
        <div ref={scroller} className="chain-scroll snap-x overflow-x-auto">
          <div className="flex w-max items-center px-8 py-8">
            {blocks.map((b, i) => (
              <div key={b.hash} className="flex items-center">
                <BlockCard
                  block={b}
                  users={users}
                  scopes={scopes}
                  selected={selected === b.index}
                  invalid={integrity?.bad.has(b.index)}
                  animate={prevSeen === -1 || b.index > prevSeen}
                  delay={prevSeen === -1 ? Math.min(i * 40, 600) : 0}
                  onClick={() => setSelected(selected === b.index ? null : b.index)}
                />
                <Connector hash={b.hash} />
              </div>
            ))}
            {blocks.length > 0 && <PendingSlot />}
          </div>
        </div>
      </Card>

      {selectedBlock ? (
        <BlockDetail block={selectedBlock} users={users} scopes={scopes} />
      ) : (
        <p className="text-center text-sm text-slate-500">Select a block to inspect its transactions.</p>
      )}
    </div>
  );
}
