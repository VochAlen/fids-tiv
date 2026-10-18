// lib/debug-state.ts — sitne dijagnostičke vrijednosti za ?debug=1 overlay (bez React state-a, bez re-rendera).
const state: Record<string, string> = {};
export function setDebug(key: string, value: string): void { state[key] = value; }
export function debugString(): string { return Object.entries(state).map(([k, v]) => `${k}=${v}`).join(' · '); }
