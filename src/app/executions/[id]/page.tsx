"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtDuration, queryClient, type ExecutionRow } from "@/lib/api";
import { Badge, Button, Card, ErrorText, PageHeader, Spinner } from "@/components/ui";
/* eslint-disable @next/next/no-img-element -- artifacts are served by our own authenticated API route */

interface NodeExec { id: string; attemptId: string; nodeId: string; nodeType: string; status: string; scopePath: string; ordinal: number; input: unknown; output: unknown; errorCode: string | null; errorMessage: string | null; durationMs: number | null; retryCount: number; startedAt: string | null }
interface Artifact { id: string; kind: string; filename: string; contentType: string; sizeBytes: number; nodeId: string | null; createdAt: string }
interface Attempt { id: string; attemptNumber: number; status: string; workerId: string | null; startedAt: string | null; finishedAt: string | null; errorCode: string | null }
interface Snapshot { execution: ExecutionRow; attempts: Attempt[]; nodes: NodeExec[]; artifacts: Artifact[]; flow: { id: string; name: string } | null; flowVersion: { id: string; versionNumber: number; order: string[] } | null; lastSequence: number }
interface Ev { eventId: string; sequence: number; timestamp: string; type: string; payload: Record<string, unknown> }
const TERMINAL = ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"];

export default function ExecutionDetail() {
  const { id } = useParams<{ id: string }>();
  const snap = useQuery({ queryKey: ["execution", id], queryFn: () => api<Snapshot>(`/executions/${id}`), refetchInterval: (q) => (q.state.data && TERMINAL.includes(q.state.data.execution.status) ? false : 3000) });
  const [events, setEvents] = useState<Ev[]>([]);
  const [conn, setConn] = useState<"connecting" | "live" | "reconnecting" | "closed">("connecting");
  const lastSeq = useRef(0);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState<NodeExec | null>(null);
  const cancel = useMutation({ mutationFn: () => api(`/executions/${id}/cancel`, { method: "POST", body: {} }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["execution", id] }) });

  // SSE with replay from lastSequence and automatic reconnection.
  useEffect(() => {
    let es: EventSource | null = null;
    let stopped = false;
    let retry = 1000;
    const connect = () => {
      if (stopped) return;
      es = new EventSource(`/api/executions/${id}/stream?lastSequence=${lastSeq.current}`);
      es.addEventListener("ready", () => { setConn("live"); retry = 1000; });
      es.addEventListener("event", (m) => {
        const ev = JSON.parse((m as MessageEvent).data) as Ev;
        if (ev.sequence <= lastSeq.current) return; // de-dup on replay
        lastSeq.current = ev.sequence;
        setEvents((prev) => [...prev, ev].slice(-2000));
        if (ev.type === "execution.status" || ev.type === "node.finished" || ev.type === "artifact.created") queryClient.invalidateQueries({ queryKey: ["execution", id] });
      });
      es.addEventListener("done", () => { setConn("closed"); es?.close(); stopped = true; queryClient.invalidateQueries({ queryKey: ["execution", id] }); });
      es.onerror = () => { es?.close(); setConn("reconnecting"); setTimeout(connect, retry); retry = Math.min(retry * 2, 15000); };
    };
    connect();
    return () => { stopped = true; es?.close(); };
  }, [id]);

  // Live preview: keep-alive ping every 5s while enabled (worker screenshots every 3–5s only while requested).
  useEffect(() => {
    if (!live) return;
    const ping = () => api(`/executions/${id}/live-preview`, { method: "POST", body: {} }).catch(() => undefined);
    ping();
    const t = setInterval(ping, 5000);
    return () => clearInterval(t);
  }, [live, id]);

  if (snap.isLoading || !snap.data) return <Spinner />;
  const { execution: ex, nodes, artifacts, attempts, flow, flowVersion } = snap.data;
  const running = !TERMINAL.includes(ex.status);
  const shots = artifacts.filter((a) => a.kind === "screenshot");
  const latestShot = shots[shots.length - 1];
  const currentAttempt = attempts[attempts.length - 1];
  const nodeRows = nodes.filter((n) => !currentAttempt || n.attemptId === currentAttempt.id);

  return (
    <div>
      <PageHeader title={`Execution ${ex.id.slice(0, 8)}`} subtitle={flow ? `${flow.name} · v${flowVersion?.versionNumber ?? "?"}` : ""} actions={<>
        <span className={`self-center rounded px-2 py-0.5 text-xs ${conn === "live" ? "bg-emerald-100 text-emerald-700" : conn === "reconnecting" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>stream: {conn}</span>
        {running && <Button variant="secondary" onClick={() => setLive(!live)}>{live ? "Stop preview" : "Live preview"}</Button>}
        {running && <Button variant="danger" disabled={cancel.isPending || ex.status === "CANCELLING"} onClick={() => cancel.mutate()}>Stop</Button>}
        <Link href={`/flows/${ex.flowId}`} className="self-center text-sm text-indigo-600">Open flow →</Link>
      </>} />
      <ErrorText error={cancel.error} />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Card><div className="text-xs uppercase text-gray-500">Status</div><div className="mt-1"><Badge status={ex.status} /></div>{ex.currentNodeId && running && <div className="mt-1 text-xs text-gray-500">at node <span className="font-mono">{ex.currentNodeId}</span></div>}</Card>
        <Card><div className="text-xs uppercase text-gray-500">Timing</div><div className="text-sm">Created {fmtDate(ex.createdAt)}</div><div className="text-sm">Started {fmtDate(ex.startedAt)}</div><div className="text-sm">Duration {fmtDuration(ex.startedAt, ex.finishedAt)}</div></Card>
        <Card><div className="text-xs uppercase text-gray-500">Runtime</div><div className="text-sm">Attempt {ex.attemptCount}/{ex.maxAttempts}</div><div className="text-sm">Chromium {ex.browserVersion ?? "—"}</div><div className="text-sm">Playwright {ex.playwrightVersion ?? "—"}</div><div className="text-xs text-gray-500">timeout {Math.round(ex.timeoutMs / 1000)}s · {ex.triggerType}</div></Card>
        <Card><div className="text-xs uppercase text-gray-500">Result</div>{ex.errorCode ? <div className="text-sm text-red-700"><span className="font-mono text-xs">{ex.errorCode}</span><div>{ex.errorMessage}</div></div> : <pre className="max-h-24 overflow-auto text-xs">{JSON.stringify(ex.output, null, 1)}</pre>}</Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Nodes (${nodeRows.length})`}>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-gray-500"><th className="px-2 py-1">#</th><th className="px-2 py-1">Node</th><th className="px-2 py-1">Status</th><th className="px-2 py-1">Scope</th><th className="px-2 py-1">Duration</th><th className="px-2 py-1">Retries</th></tr></thead>
                <tbody>{nodeRows.map((n) => <tr key={n.id} onClick={() => setSelected(n)} className={`cursor-pointer border-t border-gray-100 hover:bg-indigo-50 ${selected?.id === n.id ? "bg-indigo-50" : ""}`}><td className="px-2 py-1 text-gray-400">{n.ordinal}</td><td className="px-2 py-1"><span className="font-mono text-xs">{n.nodeId}</span><div className="text-xs text-gray-500">{n.nodeType}</div></td><td className="px-2 py-1"><Badge status={n.status} /></td><td className="px-2 py-1 font-mono text-[10px] text-gray-500">{n.scopePath || "/"}</td><td className="px-2 py-1">{n.durationMs ?? "—"}ms</td><td className="px-2 py-1">{n.retryCount}</td></tr>)}</tbody></table>
            </div>
          </Card>
          {selected && <Card title={`Node ${selected.nodeId}`} actions={<Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>}>
            {selected.errorCode && <p className="mb-2 text-sm text-red-700"><span className="font-mono text-xs">{selected.errorCode}</span> {selected.errorMessage}</p>}
            <div className="grid gap-3 md:grid-cols-2"><div><div className="text-xs font-semibold text-gray-500">Input (secrets redacted)</div><pre className="max-h-60 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(selected.input, null, 2)}</pre></div><div><div className="text-xs font-semibold text-gray-500">Output</div><pre className="max-h-60 overflow-auto rounded bg-gray-50 p-2 text-xs">{JSON.stringify(selected.output, null, 2)}</pre></div></div>
          </Card>}
          <Card title={`Event log (${events.length}${events.length ? ` · seq ${events[events.length - 1].sequence}` : ""})`}>
            <div className="max-h-80 overflow-auto font-mono text-[11px] leading-5">
              {events.length === 0 && <div className="text-gray-400">Waiting for events…</div>}
              {events.map((e) => <div key={e.eventId} className="border-b border-gray-50"><span className="text-gray-400">{e.sequence.toString().padStart(4, " ")} {new Date(e.timestamp).toLocaleTimeString()}</span> <span className="text-indigo-700">{e.type}</span> <span className="text-gray-700">{summarize(e)}</span></div>)}
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title={live ? "Live preview (3–5s)" : "Latest screenshot"}>
            {latestShot ? <a href={`/api/artifacts/${latestShot.id}/content`} target="_blank" rel="noreferrer"><img src={`/api/artifacts/${latestShot.id}/content`} alt={latestShot.filename} className="w-full rounded border" /></a> : <div className="text-sm text-gray-400">No screenshot yet.</div>}
          </Card>
          <Card title={`Artifacts (${artifacts.length})`}>
            <ul className="space-y-1 text-sm">{artifacts.map((a) => <li key={a.id} className="flex items-center justify-between gap-2"><a className="truncate text-indigo-600" href={`/api/artifacts/${a.id}/content`} target="_blank" rel="noreferrer">{a.filename}</a><span className="shrink-0 text-xs text-gray-400">{a.kind} · {(a.sizeBytes / 1024).toFixed(1)} KB</span></li>)}{artifacts.length === 0 && <li className="text-gray-400">None</li>}</ul>
          </Card>
          <Card title="Attempts"><ul className="space-y-1 text-sm">{attempts.map((a) => <li key={a.id} className="flex justify-between"><span>#{a.attemptNumber} <Badge status={a.status} /></span><span className="font-mono text-xs text-gray-500">{a.workerId?.slice(0, 18)}</span></li>)}</ul></Card>
        </div>
      </div>
    </div>
  );
}
function summarize(e: Ev): string {
  const p = e.payload;
  switch (e.type) {
    case "execution.status": return `→ ${p.status}${p.reason ? ` (${p.reason})` : ""}`;
    case "node.started": return `${p.nodeId} (${p.nodeType})${Number(p.retryCount) > 0 ? ` retry ${p.retryCount}` : ""}`;
    case "node.finished": return `${p.nodeId} ${p.status} ${p.durationMs}ms${p.errorCode ? ` ${p.errorCode}: ${p.errorMessage}` : ""}`;
    case "notification": return `[${p.level}] ${p.message}`;
    case "artifact.created": return `${p.kind} ${p.filename}`;
    case "browser.started": return `chromium ${p.browserVersion}${p.persistent ? " (persistent profile)" : ""}`;
    case "browser.closed": return `blocked requests: ${p.blockedRequests}`;
    default: return JSON.stringify(p).slice(0, 160);
  }
}
