import assert from "node:assert/strict";
import { test } from "node:test";
import { validateResponse } from "@openstockai/api-client/contract";
import { stockCost, status } from "../src/shared/state/inventory";

test("OpenAPI validates read/write responses and rejects malformed data",()=>{
 const id=crypto.randomUUID();
 assert.deepEqual(validateResponse("GET /v1/products",{items:[],total:0}),{items:[],total:0});
 assert.throws(()=>validateResponse("GET /v1/products",{items:[]}));
 assert.throws(()=>validateResponse("GET /v1/products",{items:[],total:"0"}));
 assert.throws(()=>validateResponse("GET /v1/products/{id}",{id,name:"incomplete"}));
 assert.deepEqual(validateResponse("DELETE /v1/products/{id}",{id,status:"archived"}),{id,status:"archived"});
 assert.deepEqual(validateResponse("POST /v1/purchases",{id,reference:"PUR-1",items:1}),{id,reference:"PUR-1",items:1});
 assert.throws(()=>validateResponse("POST /v1/purchases",{id,reference:"PUR-1",items:0}));
 assert.throws(()=>validateResponse("GET /v1/units",[{code:"kg",name:"Kilogram",symbol:"kg",decimals:4,active:true}]));
 assert.throws(()=>validateResponse("GET /v1/inventory",[{warehouse_id:id,product_id:id,quantity:-0.1}]));
});
test("fractional purchase quantities and exact money preserve the minimum boundary",()=>{
 assert.equal(stockCost("1.25","10.10"),"12.63");
 assert.equal(stockCost("0.001","9999999999999999.99"),"10000000000000.00");
 assert.equal(status({stock:1.25,minimum:1.25} as Parameters<typeof status>[0]),"Low stock");
});
