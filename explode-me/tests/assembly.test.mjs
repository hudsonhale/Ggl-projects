import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as T from 'three';
import {modelSchema,candidatesSchema} from '../lib/explode/schema.ts';
import {expandPlan,gridSlots} from '../lib/explode/assembly.ts';
import {createPart,disposeObject} from '../lib/explode/geometry.ts';
import {distanceMiles} from '../lib/explode/geo.ts';

const node={kind:'petal',color:'#efb62c',position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],surface:'veined',roughness:.7};
const family={id:'petal',name:'Ray floret',officialName:'Ray floret',category:'Ray florets',color:'#efb62c',pos:[0,0,0],rotation:[0,0,0],scale:[1,1,1],material:'Plant tissue',description:'Validation fixture',purpose:'Validation fixture',facts:['Validation fixture'],certainty:'estimated',sources:[],canExplore:true,nodes:[node],repeat:{count:24,layout:'ring',radius:1.2,axis:'z',step:[0,0,0],startAngle:0,arc:Math.PI*2,orient:true}};
const plan={name:'Validation fixture',officialName:'Validation fixture',family:'Test',note:'Not shipped as a selectable model.',assumptions:[],parts:[family,{...family,id:'floret',name:'Disc floret',category:'Disc florets',nodes:[{...node,kind:'floret'}],repeat:{...family.repeat,count:137,layout:'phyllotaxis',radius:.7,orient:false}}],origin:{title:'Test',kind:'unknown',lat:0,lon:0,radiusMiles:0,place:'Unknown',hint:'',claim:'Unknown',explanation:'Test',facts:[],sources:[]}};

test('repeated petals and disk florets have independent identities, positions and mesh picking data',()=>{
 const model=expandPlan(modelSchema.parse(plan));
 assert.equal(model.parts.length,161);
 assert.equal(new Set(model.parts.map(p=>p.id)).size,161);
 assert.equal(new Set(model.parts.map(p=>p.pos.join(','))).size,161);
 for(const part of [model.parts[0],model.parts[23],model.parts[24],model.parts.at(-1)]){
  const mesh=createPart(part);let selectable=0;
  mesh.traverse(o=>{if(o instanceof T.Mesh){assert.equal(o.userData.part.id,part.id);selectable++;}});
  assert.ok(selectable>0);disposeObject(mesh);
 }
});

test('all supported geometry shapes create finite measurable bounds',()=>{
 const kinds=['box','sphere','cylinder','torus','lathe','tube','extrusion','leaf','petal','seed','floret','bread','tomato','lettuce','bacon','heart','skull','brain','bone','root','brick'];
 for(const kind of kinds){
  const part={...family,shape:'generated',nodes:[{...node,kind}]};
  const mesh=createPart(part),bounds=new T.Box3().setFromObject(mesh),radius=bounds.getBoundingSphere(new T.Sphere()).radius;
  assert.ok(Number.isFinite(radius)&&radius>0,kind);
  mesh.traverse(o=>{if(o instanceof T.Mesh){for(const v of o.geometry.getAttribute('position').array)assert.ok(Number.isFinite(v),kind+' has finite vertices')}});
  disposeObject(mesh);
 }
});

test('full grid gives every bounding sphere separate space at mobile and desktop aspect ratios',()=>{
 for(const count of [1,2,24,161,600,1200])for(const aspect of [.45,1,2]){
  const slots=gridSlots(count),cell=4.75*Math.min(1,aspect)/Math.ceil(Math.sqrt(count)),radius=cell*.405;
  assert.equal(new Set(slots.map(s=>s.x+','+s.y)).size,count);
  assert.ok(2*radius<cell);
  for(const s of slots){assert.ok(Math.abs(s.x*cell)+radius<3*aspect);assert.ok(Math.abs(s.y*cell)+radius<3)}
 }
});

test('rejects duplicate identities, excessive expansion and invalid geometry',()=>{
 assert.throws(()=>expandPlan({...plan,parts:[family,family]}),/Duplicate/);
 assert.throws(()=>expandPlan({...plan,parts:[0,1,2].map(i=>({...family,id:String(i),repeat:{...family.repeat,count:600}}))}),/too many/);
 assert.equal(modelSchema.safeParse({...plan,parts:[{...family,nodes:[{...node,scale:[0,1,1]}]},family]}).success,false);
 assert.equal(candidatesSchema.safeParse({candidates:[{id:'x',label:'x',officialName:'x',confidence:1.5,kind:'plant',scope:'whole',box:[0,0,1000,1000]}]}).success,false);
});

test('distance remains accurate across the date line and antipodes',()=>{
 assert.equal(distanceMiles({lat:0,lon:0},{lat:0,lon:0}),0);
 assert.ok(Math.abs(distanceMiles({lat:0,lon:179},{lat:0,lon:-179})-138.187)<.01);
 assert.ok(Math.abs(distanceMiles({lat:0,lon:0},{lat:0,lon:180})-12436.815)<.01);
});
