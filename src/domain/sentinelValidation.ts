export const ENTITY_TYPES=['person','vehicle','place','organization','device','event'] as const;
export const SEVERITIES=['low','medium','high','critical'] as const;
export const SIGNAL_TYPES=['incident','sensor','report','alert','transaction','movement','observation'] as const;
export type Severity=typeof SEVERITIES[number]; export type SignalType=typeof SIGNAL_TYPES[number];
export function finiteNumber(v:unknown,name='value'){const n=Number(v);if(!Number.isFinite(n))throw new Error(`${name} must be finite`);return n}
export function boundedNumber(v:unknown,min:number,max:number,name='value'){const n=finiteNumber(v,name);if(n<min||n>max)throw new Error(`${name} out of range`);return n}
export function escapeLike(v:string){return v.replace(/[\\%_]/g,'\\$&')}
export function normalizeSeverity(v:unknown):Severity{const s=String(v||'low').toLowerCase();return (SEVERITIES as readonly string[]).includes(s)?s as Severity:'low'}
export function normalizeSignalType(v:unknown):SignalType{const s=String(v||'observation').toLowerCase();return (SIGNAL_TYPES as readonly string[]).includes(s)?s as SignalType:'observation'}
