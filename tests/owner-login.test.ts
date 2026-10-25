import { beforeEach, describe, expect, it, vi } from "vitest";
const OWNER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";
const GENERATION = "44444444-4444-4444-8444-444444444444";
const f = vi.hoisted(() => {
  const rpc = vi.fn(async (_name: string, _args?: unknown): Promise<{data:unknown;error:unknown}> => ({data:true,error:null}));
  const signInWithPassword = vi.fn(async (_input: unknown) => ({error:null}));
  const signOut = vi.fn(async (_options: unknown) => ({error:null}));
  const updateUser = vi.fn(async (_input: unknown): Promise<{error:unknown}> => ({error:null}));
  const getClaims = vi.fn(async (): Promise<{data:{claims:{sub:string;session_id:string}}|null;error:unknown}> => ({data:null,error:null}));
  const clearSessionCookies = vi.fn(async () => {});
  const actor = vi.fn();
  return {rpc,signInWithPassword,signOut,actor,updateUser,getClaims,clearSessionCookies,db:{rpc,auth:{signInWithPassword,signOut,updateUser,getClaims}}};
});
vi.mock("@/lib/supabase",()=>({sessionDb:async()=>f.db,serviceDb:()=>f.db,clearSessionCookies:f.clearSessionCookies}));
vi.mock("@/lib/access",()=>({actor:f.actor,audit:vi.fn()}));
vi.mock("@/lib/config",()=>({configured:()=>true,appUrl:()=>"https://admin.example.com"}));
import { POST } from "../src/app/api/auth/route";
const request=(data:object)=>POST(new Request("https://admin.example.com/api/auth",{method:"POST",headers:{origin:"https://admin.example.com","content-type":"application/json"},body:JSON.stringify(data)}));
const login=(data:object)=>request({action:"login",password:"fixture-only-password",...data});
beforeEach(()=>{
  vi.clearAllMocks();
  f.rpc.mockImplementation(async name=>({data:name==="resolve_owner_login"?"owner@example.test":true,error:null}));
  f.actor.mockResolvedValue({user:{id:OWNER},role:"owner",membership:{restaurant_id:"restaurant"},requiresPasswordChange:false,ownerAccessGeneration:GENERATION});
  f.getClaims.mockResolvedValue({data:{claims:{sub:OWNER,session_id:SESSION}},error:null});
});

describe("owner login contract",()=>{
  it("resolves a normalized alias only inside the server login and never returns the email",async()=>{
    const response=await login({identifier:"  Aurora.Owner  "});
    expect(response.status).toBe(200);
    expect(f.rpc).toHaveBeenCalledWith("resolve_owner_login",{p_alias:"aurora.owner"});
    expect(f.signInWithPassword).toHaveBeenCalledWith({email:"owner@example.test",password:"fixture-only-password"});
    expect(JSON.stringify(await response.json())).not.toContain("owner@example.test");
  });
  it("sends a temporary-password session to the enforced first change rather than the dashboard",async()=>{
    f.actor.mockResolvedValueOnce({user:{id:OWNER},role:"owner",membership:{restaurant_id:"restaurant"},requiresPasswordChange:true,ownerAccessGeneration:GENERATION});
    const response=await login({email:"owner@example.test"});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({requiresPasswordChange:true,redirect:"/login?mode=password"});
    expect(f.signOut).not.toHaveBeenCalled();
  });
  it("clears a successful provider session if an unresolved alias used the timing placeholder",async()=>{
    f.rpc.mockImplementation(async name=>({data:name==="resolve_owner_login"?null:true,error:null}));
    const response=await login({identifier:"unknown.owner"});
    expect(response.status).toBe(401);
    expect(f.actor).not.toHaveBeenCalled();
    expect(f.signOut).toHaveBeenCalledExactlyOnceWith({scope:"local"});
    expect(f.clearSessionCookies).toHaveBeenCalledOnce();
    expect(JSON.stringify(await response.json())).not.toContain("unavailable@invalid.example");
  });
});

describe("owner password change authorization",()=>{
  it("unlocks only the generation and verified session after Auth accepted the new password",async()=>{
    const response=await request({action:"password",password:"new-fixture-password"});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ok:true,redirect:"/dashboard"});
    expect(f.actor).toHaveBeenCalledWith({allowPasswordChange:true});
    expect(f.updateUser).toHaveBeenCalledExactlyOnceWith({password:"new-fixture-password"});
    expect(f.rpc).toHaveBeenCalledWith("complete_owner_password_change",{p_user_id:OWNER,p_generation:GENERATION,p_session_id:SESSION});
    const rpcIndex=f.rpc.mock.calls.findIndex(([name])=>name==="complete_owner_password_change");
    expect(f.updateUser.mock.invocationCallOrder[0]).toBeLessThan(f.rpc.mock.invocationCallOrder[rpcIndex]!);
  });
  it("does not clear a newer reset when the generation changed during the Auth mutation",async()=>{
    f.rpc.mockImplementation(async name=>({data:name==="complete_owner_password_change"?false:true,error:null}));
    const response=await request({action:"password",password:"new-fixture-password"});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:"PASSWORD_CHANGE_STALE"});
    expect(f.updateUser).toHaveBeenCalledOnce();
  });
  it.each(["mismatched-sub","provider-error"])("rejects %s claims before changing Auth or clearing the gate",async mode=>{
    f.getClaims.mockResolvedValueOnce({data:{claims:{sub:mode==="mismatched-sub"?"55555555-5555-4555-8555-555555555555":OWNER,session_id:SESSION}},error:mode==="provider-error"?new Error("private-claim-details"):null});
    const response=await request({action:"password",password:"new-fixture-password"});
    expect(response.status).toBe(401);
    expect(f.updateUser).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.some(([name])=>name==="complete_owner_password_change")).toBe(false);
  });
  it("keeps the application gate closed when the Auth provider rejects the password",async()=>{
    f.updateUser.mockResolvedValueOnce({error:{message:"private-provider-details"}});
    const response=await request({action:"password",password:"new-fixture-password"});
    expect(response.status).toBe(400);
    expect(f.rpc.mock.calls.some(([name])=>name==="complete_owner_password_change")).toBe(false);
    expect(JSON.stringify(await response.json())).not.toContain("private-provider-details");
  });
  it("preserves administrator password changes without applying an owner generation",async()=>{
    f.actor.mockResolvedValueOnce({user:{id:OWNER},role:"superadmin",membership:null});
    const response=await request({action:"password",password:"new-fixture-password"});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({redirect:"/admin"});
    expect(f.getClaims).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.some(([name])=>name==="complete_owner_password_change")).toBe(false);
  });
});
