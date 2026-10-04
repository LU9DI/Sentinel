export const CASE_STATES = ['open','investigating','contained','resolved','closed'] as const;
export type CaseState = typeof CASE_STATES[number];
const transitions: Record<CaseState, CaseState[]> = {
  open: ['investigating','closed'],
  investigating: ['contained','resolved'],
  contained: ['resolved'],
  resolved: ['closed'],
  closed: []
};
export function canTransition(from: string, to: string): boolean {
  return (transitions[from as CaseState] ?? []).includes(to as CaseState);
}
export function assertTransition(from: string, to: string): asserts to is CaseState {
  if (!canTransition(from,to)) throw new Error(`invalid case transition: ${from} -> ${to}`);
}
