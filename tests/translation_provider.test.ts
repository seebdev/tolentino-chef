import {describe,it,expect,vi} from "vitest";
import type {SupabaseClient} from "@supabase/supabase-js";
import {buildTranslationRequest,validateTranslation,translateJob,reservationMicroUsd} from "../scripts/lib/translation-provider.mjs";
import {runTranslationWorker,translationConfig} from "../scripts/translation-worker.mjs";
const job={id:"job",entity_id:"entity",language:"en",source_language:"es",source_fields:{name:"Pizza 4 quesos",description:"",ingredients:"Queso",tags:[],extras:[{name:"Tomate 50 g"}],variants:[]},restaurant_brand:"Aurora"};
const translated={entity_id:"entity",language:"en",fields:{name:"4 cheese pizza",description:"",ingredients:"Cheese",tags:[],extras:[{name:"Tomato 50 g"}],variants:[]}};
const reply=(value=translated)=>new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(value)}]}],usage:{input_tokens:1000,output_tokens:100}}),{status:200});
describe("structured menu translation boundary",()=>{
 it("sends only menu fields with strict schema, no tools, no stored response",()=>{const request=buildTranslationRequest(job,"gpt-4.1-mini-2025-04-14");expect(request.store).toBe(false);expect(request.text.format.strict).toBe(true);expect(request).not.toHaveProperty("tools");expect(request.input[1].content).not.toContain("owner_email");expect(request.input[0].content).toContain("untrusted data")});
 it("accepts a complete valid translation and accounts usage",async()=>{const result=await translateJob(job,{key:"fixture-key",fetchImpl:vi.fn(async()=>reply())});expect(result.fields).toEqual(translated.fields);expect(result.costMicroUsd).toBe(560);expect(reservationMicroUsd("gpt-4.1-mini-2025-04-14")).toBeGreaterThan(result.costMicroUsd)});
 it.each([401,403,429,500])("classifies HTTP %i without leaking provider details",async status=>{await expect(translateJob(job,{key:"fixture-key",fetchImpl:vi.fn(async()=>new Response("SECRET PROVIDER BODY",{status}))})).rejects.toMatchObject({code:status===429?"provider_rate_limited":status<500?"provider_unauthorized":"provider_http_500",retryable:status===429||status===500});});
 it("treats timeout as unknown charged outcome for conservative accounting",async()=>{await expect(translateJob(job,{key:"fixture-key",fetchImpl:vi.fn(async()=>{throw new Error("timeout")})})).rejects.toMatchObject({code:"provider_timeout_or_network",chargedUnknown:true,retryable:true})});
 it("rejects changed ID, language, quantities and array order/shape",()=>{
  expect(()=>validateTranslation(job,{...translated,entity_id:"foreign"})).toThrow("invalid_identity");
  expect(()=>validateTranslation(job,{...translated,language:"fr"})).toThrow("invalid_identity");
  expect(()=>validateTranslation(job,{...translated,fields:{...translated.fields,name:"5 cheese pizza"}})).toThrow("protected_tokens_changed");
  expect(()=>validateTranslation(job,{...translated,fields:{...translated.fields,extras:[]}})).toThrow("array_shape_changed");
 });
 it("rejects invented dietary claims, nonempty translations of empty content and new fields",()=>{
  expect(()=>validateTranslation(job,{...translated,fields:{...translated.fields,ingredients:"Gluten-free cheese"}})).toThrow("unsupported_claim");
  expect(()=>validateTranslation(job,{...translated,fields:{...translated.fields,ingredients:"Cheese and shrimp"}})).toThrow("unsupported_claim");
  expect(()=>validateTranslation(job,{...translated,fields:{...translated.fields,description:"Best pizza"}})).toThrow("invalid_field");
  expect(()=>validateTranslation(job,{...translated,fields:{...translated.fields,price:15}})).toThrow("field_shape_changed");
 });
 it("does not execute with a key but no enabled budget",async()=>{
  const provider=vi.fn(),onEvent=vi.fn();expect(translationConfig({NODE_ENV:"test",OPENAI_API_KEY:"fixture"}).enabled).toBe(false);
  const result=await runTranslationWorker({env:{NODE_ENV:"test",OPENAI_API_KEY:"fixture"},provider,onEvent});expect(result.processed).toBe(0);expect(provider).not.toHaveBeenCalled();
 });
 it("stops on persisted budget refusal before calling provider",async()=>{
  const provider=vi.fn(),onEvent=vi.fn();const db={rpc:vi.fn(async(name:string)=>({error:null,data:name==="claim_translation_job"?{blocked:"budget"}: {}}))};
  const env={NODE_ENV:"test" as const,TRANSLATION_ENABLED:"true",TRANSLATION_BUDGET_USD:"2",OPENAI_API_KEY:"fixture",NEXT_PUBLIC_SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"fixture"};
  const result=await runTranslationWorker({env,provider,onEvent,db:db as unknown as SupabaseClient});expect(result.reason).toBe("budget");expect(provider).not.toHaveBeenCalled();
 });
 it("rejects a model without verified pricing and structured-output configuration",()=>{expect(()=>buildTranslationRequest(job,"invented-model")).toThrow("model_pricing_not_configured")});
});
