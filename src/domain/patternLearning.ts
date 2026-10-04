import { boundedNumber } from './sentinelValidation.js';
import type { TemporalSignal, PatternDefinition } from './temporalSequenceEngine.js';

export const LEARNING_ALGORITHM_VERSION = 'sentinel-learning-v11.1';

export type PatternCandidate = {
  tenantId: string;
  sequence: string[];
  support: number;
  occurrences: number;
  consistency: number;
  candidateScore: number;
  preferredWindowMs: number;
  maxWindowMs: number;
  evidence: Array<{ type: string; value: string; weight: number }>;
};

export type Anomaly = {
  tenantId: string;
  signalType: string;
  bucketStart: string;
  observedCount: number;
  baselineMedian: number;
  baselineMad: number;
  anomalyScore: number;
  severity: 'low' | 'medium' | 'high';
  reason: string;
};

function ms(v: string | Date): number { return new Date(v).getTime(); }
function percentile(values: number[], p: number): number { if (!values.length) return 0; const sorted = [...values].sort((a,b)=>a-b); const index=(sorted.length-1)*p, lower=Math.floor(index), upper=Math.ceil(index); if(lower===upper)return sorted[lower]; return sorted[lower]+(sorted[upper]-sorted[lower])*(index-lower); }
function median(values: number[]): number { return percentile(values,0.5); }
function mad(values:number[],m:number):number{return median(values.map(v=>Math.abs(v-m)));}
function round6(n:number):number{return Number(n.toFixed(6));}

export function discoverPatternCandidates(signals:TemporalSignal[],options:{minLength?:number;maxLength?:number;maxWindowMs?:number;minOccurrences?:number}={}):PatternCandidate[]{
 const minLength=Math.max(2,Math.floor(options.minLength??2)), maxLength=Math.min(4,Math.max(minLength,Math.floor(options.maxLength??4))), maxWindowMs=boundedNumber(options.maxWindowMs??30*60_000,1,Number.MAX_SAFE_INTEGER,'maxWindowMs'), minOccurrences=Math.max(2,Math.floor(options.minOccurrences??2));
 const byTenant=new Map<string,TemporalSignal[]>(); for(const s of signals){if(!byTenant.has(s.tenantId))byTenant.set(s.tenantId,[]);byTenant.get(s.tenantId)!.push(s);}
 const out:PatternCandidate[]=[];
 for(const [tenantId,tenantSignals] of byTenant){const sorted=[...tenantSignals].sort((a,b)=>ms(a.occurredAt)-ms(b.occurredAt)||a.id.localeCompare(b.id));const counts=new Map<string,number>(),elapsedByKey=new Map<string,number[]>();
  for(let i=0;i<sorted.length;i++){const seq:TemporalSignal[]=[sorted[i]];const walk=(start:number)=>{if(seq.length>=minLength){const key=seq.map(s=>s.type).join('>'),elapsed=ms(seq.at(-1)!.occurredAt)-ms(seq[0].occurredAt);counts.set(key,(counts.get(key)??0)+1);const values=elapsedByKey.get(key)??[];values.push(elapsed);elapsedByKey.set(key,values);}if(seq.length>=maxLength)return;for(let j=start;j<sorted.length;j++){const next=sorted[j],elapsed=ms(next.occurredAt)-ms(seq[0].occurredAt);if(elapsed>maxWindowMs)break;if(j===start&&next.id===seq.at(-1)!.id)continue;seq.push(next);walk(j+1);seq.pop();}};walk(i+1);}
  for(const [key,occurrences] of counts){if(occurrences<minOccurrences)continue;const sequence=key.split('>'),elapsed=elapsedByKey.get(key)??[],preferred=Math.max(1,Math.round(percentile(elapsed,.5))),max=Math.max(preferred,Math.round(percentile(elapsed,.9))),consistency=elapsed.length<=1?1:Math.max(0,1-mad(elapsed,median(elapsed))/Math.max(1,preferred)),support=occurrences/Math.max(1,tenantSignals.length),recurrence=Math.min(1,occurrences/10),candidateScore=round6(.45*Math.min(1,support*20)+.35*consistency+.20*recurrence);out.push({tenantId,sequence,support:round6(support),occurrences,consistency:round6(consistency),candidateScore,preferredWindowMs:preferred,maxWindowMs:max,evidence:[{type:'recurrence',value:`occurrences:${occurrences}`,weight:.20},{type:'support',value:`support:${round6(support)}`,weight:.45},{type:'temporal_consistency',value:`median:${preferred}ms; p90:${max}ms`,weight:.35}]});}}
 return out.sort((a,b)=>b.candidateScore-a.candidateScore||a.tenantId.localeCompare(b.tenantId)||a.sequence.join('>').localeCompare(b.sequence.join('>')));
}
export function detectVolumeAnomalies(signals:TemporalSignal[],options:{bucketMs?:number;baselineBuckets?:number;thresholdMad?:number}={}):Anomaly[]{const bucketMs=boundedNumber(options.bucketMs??15*60_000,60_000,24*60*60_000,'bucketMs'),baselineBuckets=Math.max(8,Math.floor(options.baselineBuckets??96)),thresholdMad=Math.max(1,Number(options.thresholdMad??3));const groups=new Map<string,TemporalSignal[]>();for(const s of signals){const bucket=Math.floor(ms(s.occurredAt)/bucketMs)*bucketMs,key=`${s.tenantId}|${s.type}`,list=groups.get(key)??[];list.push({...s,occurredAt:new Date(bucket).toISOString()});groups.set(key,list);}const anomalies:Anomaly[]=[];for(const [key,rows] of groups){const [tenantId,signalType]=key.split('|'),counts=new Map<number,number>();for(const row of rows){const b=ms(row.occurredAt);counts.set(b,(counts.get(b)??0)+1);}const buckets=[...counts.keys()].sort((a,b)=>a-b);for(let i=0;i<buckets.length;i++){const currentBucket=buckets[i],historical=buckets.filter(b=>b<currentBucket).slice(-baselineBuckets).map(b=>counts.get(b)??0);if(historical.length<8)continue;const observed=counts.get(currentBucket)??0,m=median(historical),d=mad(historical,m),score=Math.max(0,(observed-m)/Math.max(1,d));if(score<thresholdMad)continue;const severity:Anomaly['severity']=score>=6?'high':score>=4?'medium':'low';anomalies.push({tenantId,signalType,bucketStart:new Date(currentBucket).toISOString(),observedCount:observed,baselineMedian:round6(m),baselineMad:round6(d),anomalyScore:round6(score),severity,reason:`volume_spike:${observed} vs median:${round6(m)} mad:${round6(d)}`});}}return anomalies.sort((a,b)=>b.anomalyScore-a.anomalyScore||a.bucketStart.localeCompare(b.bucketStart));}
export function candidateToPattern(candidate:PatternCandidate,id:string,version:number):PatternDefinition{return{id,version,name:`Learned ${candidate.sequence.join(' → ')}`,sequence:candidate.sequence,minWindowMs:0,preferredWindowMs:candidate.preferredWindowMs,maxWindowMs:candidate.maxWindowMs,weights:{temporal:.30,sharedEntity:.22,relatedEntity:.12,geospatial:.16,typeRelationship:.12,sequenceOrder:.08,entityGraph:.12},geo:{},minConfidence:Math.max(.5,round6(candidate.candidateScore*.75)),enabled:false};}
