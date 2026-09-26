import type {Part,Source,Specimen,Vec3} from './model';
import type {ModelPlan} from './schema';
/** Every physical instance becomes an independent pickable part, never a grouped ring. */
export function expandPlan(plan:ModelPlan,sources:Source[]=[],searchSuggestions?:string):Specimen{
 const parts:Part[]=[];
 for(const template of plan.parts){const r=template.repeat,n=r?.count??1;for(let i=0;i<n;i++){if(parts.length>=1200)throw new Error('This assembly has too many parts for a phone. Choose a smaller section.');const pos=[...template.pos] as Vec3,rotation=[...template.rotation] as Vec3;let angle=0,radius=0;
 if(r&&n>1){if(r.layout==='ring'){angle=r.startAngle+i/n*r.arc;radius=r.radius}else if(r.layout==='phyllotaxis'){angle=r.startAngle+i*2.39996323;radius=r.radius*Math.sqrt((i+.5)/n)}else if(r.layout==='line'){for(let k=0;k<3;k++)pos[k]+=r.step[k]*i}
 if(r.layout==='ring'||r.layout==='phyllotaxis'){const a=r.axis==='x'?1:0,b=r.axis==='z'?1:2;pos[a]+=Math.cos(angle)*radius;pos[b]+=Math.sin(angle)*radius;if(r.orient)rotation[r.axis==='x'?0:r.axis==='y'?1:2]+=angle-Math.PI/2;}
 }
 const factor=1+((i*73%17)-8)*.003;const vary=(color:string)=>'#'+color.match(/[0-9a-f]{2}/gi)!.map(x=>Math.min(255,Math.round(parseInt(x,16)*factor)).toString(16).padStart(2,'0')).join('');const varied=vary(template.color);
 parts.push({...template,id:`${template.id}-${i}`,name:n>1?`${template.name} ${i+1}`:template.name,color:varied,nodes:template.nodes.map(node=>({...node,color:vary(node.color)})),pos,rotation,shape:'generated',repeat:undefined});}}
 if(new Set(parts.map(p=>p.id)).size!==parts.length)throw new Error('Duplicate part identities in reconstruction.');
 return {id:crypto.randomUUID(),name:plan.name,officialName:plan.officialName,family:plan.family,parts,note:plan.note,assumptions:plan.assumptions,origin:plan.origin,sources,searchSuggestions};
}
/** Bounding-sphere packing: every part fits inside 0.41 of a grid cell. */
export function gridSlots(count:number){const columns=Math.ceil(Math.sqrt(count)),rows=Math.ceil(count/columns);return Array.from({length:count},(_,i)=>({x:i%columns-(columns-1)/2,y:(rows-1)/2-Math.floor(i/columns),columns,rows}));}
