import type {Request,Response,NextFunction} from 'express';
import type {AuthClaims} from '../infra/auth.js';
export type TenantRequest=Request & {tenantId:string;actorId?:string;actorRole?:string;auth?:AuthClaims};
export function requireTenant(req:TenantRequest,res:Response,next:NextFunction){const auth=req.auth;const header=req.header('x-tenant-id');if(!auth)return res.status(401).json({error:'authentication required'});if(!header||header!==auth.tenantId)return res.status(403).json({error:'tenant mismatch'});req.tenantId=auth.tenantId;req.actorId=auth.sub;req.actorRole=auth.role;next();}
