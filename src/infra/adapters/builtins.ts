import type {NotificationAdapter} from './types.js';
const unavailable=(channel:string):NotificationAdapter=>({channel,async deliver(){return{ok:false,error:{kind:'permanent',message:`${channel} adapter not configured`}}}});
export const adapters:Record<string,NotificationAdapter>={'in-app':{channel:'in-app',async deliver(ctx){return{ok:true,result:{providerMessageId:`inapp:${ctx.alertId}`}}}},webhook:unavailable('webhook'),email:unavailable('email'),sms:unavailable('sms'),custom:unavailable('custom')};
export function getAdapter(channel:string){return adapters[channel]??adapters.custom}
