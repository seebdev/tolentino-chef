import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { establishOwnerPassword, aliasInput } from "../src/lib/owner-access";
const ADMIN="cccccccc-cccc-4ccc-8ccc-cccccccccccc",REST="11111111-1111-4111-8111-111111111111",OWNER="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",REQ="44444444-4444-4444-8444-444444444444";
const password="FixtureOnly-Password123";
type Failure={code?:string;status?:number}|null;
let user:User|null, state:string, completeFailure:boolean, lost:boolean, providerFailure:Failure, newUser:boolean;
const rpc=vi.fn(async(name:string,args?:Record<string,unknown>):Promise<{data:unknown;error:Failure}>=>{
 if(name==="claim_owner_access")return{data:{state,ownerId:OWNER,email:"owner@example.test",newUser,leaseToken:REQ},error:null};
 if(name==="begin_owner_auth"){state="auth_started";return{data:true,error:null};}
 if(name==="complete_owner_access"){if(completeFailure)return{data:null,error:{code:"08006"}};state="completed";return{data:true,error:null};}
 if(name==="fail_owner_access"){state="failed";return{data:args?.p_code!==undefined,error:null};}
 throw new Error("Unexpected RPC");
});
const getUserById=vi.fn(async()=>({data:{user},error:user?null:{code:"user_not_found",status:404}}));
const mutate=async(input:Record<string,unknown>)=>{
 if(providerFailure)return{data:{user:null},error:providerFailure};
 user={id:OWNER,email:"owner@example.test",app_metadata:input.app_metadata} as User;
 if(lost)throw new Error("private-provider-details");
 return{data:{user},error:null};
};
const updateUserById=vi.fn(async(_id:string,input:Record<string,unknown>)=>mutate(input));
const createUser=vi.fn(async(input:Record<string,unknown>)=>mutate(input));
const db={rpc,auth:{admin:{getUserById,updateUserById,createUser}}} as unknown as SupabaseClient;
const run=(supplied?:string)=>establishOwnerPassword(db,ADMIN,REST,REQ,"aurora.owner",supplied);
beforeEach(()=>{vi.clearAllMocks();state="reserved";completeFailure=false;lost=false;providerFailure=null;newUser=false;user={id:OWNER,email:"owner@example.test",app_metadata:{existing:"retained"}} as unknown as User;});
describe("owner access workflow boundaries",()=>{
 it("validates the same normalized unique alias contract",()=>{expect(aliasInput.parse("  Aurora.Owner ")).toBe("aurora.owner");expect(aliasInput.parse("")).toBeNull();expect(()=>aliasInput.parse("ownér")).toThrow();});
 it("sets a manual credential once and never persists its value or digest in RPC/audit data",async()=>{
  const response=await run(password);expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({temporaryPassword:password,secretAvailable:true,requiresPasswordChange:true});
  expect(updateUserById).toHaveBeenCalledExactlyOnceWith(OWNER,{password,app_metadata:{existing:"retained",owner_access_request_id:REQ,owner_access_actor_id:ADMIN}});
  expect(JSON.stringify(rpc.mock.calls)).not.toContain(password);
  const replay=await run(password);
  expect(await replay.json()).toMatchObject({replayed:true,secretAvailable:false});
  expect(updateUserById).toHaveBeenCalledTimes(1);
 });
 it("generates a high-entropy temporary secret and only returns it on the committed first response",async()=>{
  const response=await run();const data=await response.json();
  expect(data.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect(JSON.stringify(rpc.mock.calls)).not.toContain(data.temporaryPassword);
 });
 it("recovers an Auth response lost after commit without issuing another credential",async()=>{
  lost=true;expect((await run(password)).status).toBe(200);
  expect(updateUserById).toHaveBeenCalledTimes(1);
  expect(await (await run(password)).json()).toMatchObject({secretAvailable:false,replayed:true});
  expect(updateUserById).toHaveBeenCalledTimes(1);
 });
 it("reconciles SQL response failure with the Auth marker and never shows a credential on a later attempt",async()=>{
  completeFailure=true;await expect(run(password)).rejects.toMatchObject({status:503,code:"OWNER_ACCESS_UNCONFIRMED"});
  completeFailure=false;
  const recovered=await run("A-different-fixture-password");
  expect(await recovered.json()).toMatchObject({secretAvailable:false});
  expect(updateUserById).toHaveBeenCalledTimes(1);
 });
 it("does not repeat uncertain Auth mutations even if the caller supplies a different password",async()=>{
  state="auth_started";const response=await run(password);
  expect(response.status).toBe(202);
  expect(updateUserById).not.toHaveBeenCalled();expect(createUser).not.toHaveBeenCalled();
 });
 it("creates only the reserved identity and assigns it through atomic completion",async()=>{
  newUser=true;user=null;const response=await run(password);
  expect(response.status).toBe(200);
  expect(createUser).toHaveBeenCalledExactlyOnceWith({id:OWNER,email:"owner@example.test",password,email_confirm:true,app_metadata:{owner_access_request_id:REQ,owner_access_actor_id:ADMIN}});
  expect(rpc).toHaveBeenCalledWith("complete_owner_access",{p_actor_id:ADMIN,p_request_id:REQ});
 });
 it("never adopts an existing account for an unassigned restaurant",async()=>{
  newUser=true;await expect(run(password)).rejects.toMatchObject({status:409,code:"OWNER_IDENTITY_CONFLICT"});
  expect(updateUserById).not.toHaveBeenCalled();expect(createUser).not.toHaveBeenCalled();
 });
 it("classifies a true email conflict and fails its reservation without deleting anyone",async()=>{
  newUser=true;user=null;providerFailure={code:"email_exists",status:422};
  await expect(run(password)).rejects.toMatchObject({status:409,code:"OWNER_EMAIL_EXISTS"});
  expect(rpc).toHaveBeenCalledWith("fail_owner_access",{p_actor_id:ADMIN,p_request_id:REQ,p_code:"OWNER_EMAIL_EXISTS"});
  expect(updateUserById).not.toHaveBeenCalled();
 });
 it("leaves uncertain provider errors recoverable and never mislabels them as conflicts",async()=>{
  user=null;newUser=true;providerFailure={code:"unexpected_failure",status:500};
  await expect(run(password)).rejects.toMatchObject({status:503});
  expect(rpc.mock.calls.some(([name])=>name==="fail_owner_access")).toBe(false);
 });
 it("rejects invalid passwords before reserving or changing an account",async()=>{
  await expect(run("short")).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();expect(updateUserById).not.toHaveBeenCalled();
 });
 it("does no Auth work on a concurrent pending request",async()=>{
  state="pending";expect((await run(password)).status).toBe(202);
  expect(getUserById).not.toHaveBeenCalled();expect(updateUserById).not.toHaveBeenCalled();
 });
});
