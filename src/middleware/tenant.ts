import type {Request,Response,NextFunction} from 'express';
import type {AuthClaims} from '../infra/auth.js';

export type TenantRequest=Request & {tenantId?:string;actorId?:string;actorRole?:string;auth?:AuthClaims};

export function requireTenant(req:Request,res:Response,next:NextFunction){
  const typed=req as TenantRequest;
  const auth=typed.auth;
  const header=req.header('x-tenant-id');
  if(!auth)return res.status(401).json({error:'authentication required'});
  if(!header||header!==auth.tenantId)return res.status(403).json({error:'tenant mismatch'});
  typed.tenantId=auth.tenantId;
  typed.actorId=auth.sub;
  typed.actorRole=auth.role;
  next();
}
