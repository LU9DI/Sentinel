export type DeliveryContext={tenantId:string;alertId:string;caseId:string;channel:string;payload:Record<string,unknown>};
export type DeliveryResult={providerMessageId?:string};
export type DeliveryFailure={kind:'permanent'|'transient'|'rate_limit'|'credential';status?:number;retryAfterMs?:number;message:string};
export type AdapterResult={ok:true;result:DeliveryResult}|{ok:false;error:DeliveryFailure};
export interface NotificationAdapter{channel:string;deliver(ctx:DeliveryContext):Promise<AdapterResult>}
