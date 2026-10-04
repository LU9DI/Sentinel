import { normalizeSeverity, type Severity } from './sentinelValidation.js';
import type { TemporalSignal } from './temporalSequenceEngine.js';

export const PREDICTIVE_ALGORITHM_VERSION = 'sentinel-predictive-v12.1';

export type PredictiveFactor = { type: string; weight: number; evidence: string };
export type PredictiveSignal = {
  tenantId: string;
  targetType: string;
  targetValue: string;
  horizonMs: number;
  score: number;
  confidence: number;
  severity: Severity;
  factors: PredictiveFactor[];
  algorithmVersion: string;
  generatedAt: string;
};

const clamp = (n:number) => Math.max(0, Math.min(1, Number(n.toFixed(6))));
const ms = (v:string|Date) => new Date(v).getTime();

function median(values:number[]):number {
  if (!values.length) return 0;
  const s=[...values].sort((a,b)=>a-b), i=(s.length-1)/2;
  return Number.isInteger(i) ? s[i] : (s[Math.floor(i)]+s[Math.ceil(i)])/2;
}

/**
 * Deterministic, explainable short-horizon forecast. It predicts elevated
 * signal activity; it does not authorize incidents or external actions.
 */
export function generatePredictiveSignals(
  signals: TemporalSignal[],
  options:{horizonMs?:number; bucketMs?:number; baselineBuckets?:number; minHistoryBuckets?:number}={},
): PredictiveSignal[] {
  const horizonMs=Math.max(60_000, Math.floor(options.horizonMs ?? 30*60_000));
  const bucketMs=Math.max(60_000, Math.floor(options.bucketMs ?? 15*60_000));
  const baselineBuckets=Math.max(8, Math.floor(options.baselineBuckets ?? 16));
  const minHistory=Math.max(4, Math.floor(options.minHistoryBuckets ?? 8));
  const byTenantType=new Map<string, TemporalSignal[]>();
  for(const s of signals){const key=`${s.tenantId}|${s.type}`; const a=byTenantType.get(key)??[]; a.push(s); byTenantType.set(key,a);}
  const out:PredictiveSignal[]=[];
  for(const [key,rows] of byTenantType){
    const [tenantId,targetType]=key.split('|');
    const ordered=[...rows].sort((a,b)=>ms(a.occurredAt)-ms(b.occurredAt)||a.id.localeCompare(b.id));
    if(!ordered.length) continue;
    const latest=ms(ordered.at(-1)!.occurredAt);
    const buckets=new Map<number,number>();
    for(const s of ordered){const b=Math.floor(ms(s.occurredAt)/bucketMs)*bucketMs; buckets.set(b,(buckets.get(b)??0)+1);}
    const lastBucket=Math.floor(latest/bucketMs)*bucketMs;
    const counts:number[]=[];
    for(let i=baselineBuckets;i>=1;i--) counts.push(buckets.get(lastBucket-i*bucketMs)??0);
    if(counts.filter(v=>v>0).length<minHistory) continue;
    const baseline=median(counts);
    const recent=counts.slice(-Math.min(4,counts.length));
    const recentMedian=median(recent);
    const trend=baseline>0 ? clamp((recentMedian-baseline)/Math.max(1,baseline)) : recentMedian>0 ? 1 : 0;
    const acceleration=counts.length>=4 ? clamp(((counts.at(-1)??0)-(counts.at(-2)??0))/Math.max(1,baseline)) : 0;
    const persistence=clamp(recent.filter(v=>v>=Math.max(1,baseline)).length/recent.length);
    const score=clamp(trend*0.55+acceleration*0.20+persistence*0.25);
    const confidence=clamp(Math.min(1,counts.length/baselineBuckets)*0.65 + Math.min(1,ordered.length/50)*0.35);
    if(score<0.35) continue;
    const severity=normalizeSeverity(score>=.85?'critical':score>=.65?'high':score>=.45?'medium':'low');
    out.push({tenantId,targetType,targetValue:targetType,horizonMs,score,confidence,severity,algorithmVersion:PREDICTIVE_ALGORITHM_VERSION,generatedAt:new Date(latest).toISOString(),factors:[
      {type:'baseline_deviation',weight:.55,evidence:`baselineMedian:${baseline}; recentMedian:${recentMedian}; trend:${trend}`},
      {type:'short_term_acceleration',weight:.20,evidence:`last:${counts.at(-1)??0}; previous:${counts.at(-2)??0}; baseline:${baseline}`},
      {type:'persistence',weight:.25,evidence:`elevatedBuckets:${recent.filter(v=>v>=Math.max(1,baseline)).length}/${recent.length}`},
    ]});
  }
  return out.sort((a,b)=>b.score-a.score||a.tenantId.localeCompare(b.tenantId)||a.targetType.localeCompare(b.targetType));
}
