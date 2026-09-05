"use client";
import React from "react";

export const STATUS_COLORS: Record<string, string> = {
  SUCCEEDED: "bg-emerald-100 text-emerald-800", FAILED: "bg-red-100 text-red-800", CANCELLED: "bg-gray-200 text-gray-700", TIMED_OUT: "bg-orange-100 text-orange-800",
  RUNNING: "bg-blue-100 text-blue-800 animate-pulse", QUEUED: "bg-amber-100 text-amber-800", LEASED: "bg-amber-100 text-amber-800", STARTING: "bg-blue-100 text-blue-800", CANCELLING: "bg-orange-100 text-orange-800",
  WORKER_LOST: "bg-red-100 text-red-800", CREATED: "bg-gray-100 text-gray-700", SKIPPED: "bg-gray-100 text-gray-500", NOT_REACHED: "bg-gray-100 text-gray-400", PENDING: "bg-gray-100 text-gray-600",
  ONLINE: "bg-emerald-100 text-emerald-800", DRAINING: "bg-amber-100 text-amber-800", STOPPED: "bg-gray-200 text-gray-700", LOST: "bg-red-100 text-red-800",
};
export function Badge({ status, children }: { status?: string; children?: React.ReactNode }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status ?? ""] ?? "bg-gray-100 text-gray-700"}`}>{children ?? status}</span>;
}
export function Button({ variant = "primary", className = "", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const v = { primary: "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-300", secondary: "bg-white border border-gray-300 text-gray-800 hover:bg-gray-50", danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300", ghost: "text-gray-700 hover:bg-gray-100" }[variant];
  return <button {...p} className={`rounded px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed ${v} ${className}`} />;
}
export const Input = (p: React.InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none ${p.className ?? ""}`} />;
export const Textarea = (p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-xs focus:border-indigo-500 focus:outline-none ${p.className ?? ""}`} />;
export const Select = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm ${p.className ?? ""}`} />;
export function Field({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">{label}</span>{children}{help && <span className="mt-0.5 block text-xs text-gray-500">{help}</span>}</label>;
}
export function Card({ title, actions, children, className = "" }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-gray-200 bg-white shadow-sm ${className}`}>{(title || actions) && <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2"><h2 className="text-sm font-semibold text-gray-800">{title}</h2><div className="flex gap-2">{actions}</div></header>}<div className="p-4">{children}</div></section>;
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return <div className="mb-4 flex items-start justify-between"><div><h1 className="text-xl font-semibold text-gray-900">{title}</h1>{subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}</div><div className="flex gap-2">{actions}</div></div>;
}
export function Table<T>({ rows, cols, empty = "Nothing here yet.", rowKey }: { rows: T[]; cols: { h: string; c: (r: T) => React.ReactNode; w?: string }[]; empty?: string; rowKey: (r: T) => string }) {
  return <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">{cols.map((c) => <th key={c.h} className={`px-2 py-2 ${c.w ?? ""}`}>{c.h}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={cols.length} className="px-2 py-6 text-center text-gray-400">{empty}</td></tr> : rows.map((r) => <tr key={rowKey(r)} className="border-b border-gray-100 hover:bg-gray-50">{cols.map((c) => <td key={c.h} className="px-2 py-2 align-top">{c.c(r)}</td>)}</tr>)}</tbody></table></div>;
}
export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as { code?: string; message?: string };
  return <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{e.code && <span className="mr-2 font-mono text-xs">{e.code}</span>}{e.message ?? String(error)}</p>;
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}><div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{title}</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button></div>{children}</div></div>;
}
export const Spinner = () => <div className="py-8 text-center text-sm text-gray-400">Loading…</div>;
