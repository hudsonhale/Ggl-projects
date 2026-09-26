export type Vec3=[number,number,number];
export type Vec2=[number,number];
export interface Source {title:string;url:string}
export interface GeometryNode {kind:string;color:string;position:Vec3;rotation:Vec3;scale:Vec3;surface:'smooth'|'porous'|'veined'|'fibrous'|'grain'|'speckled'|'metal'|'skin';roughness:number;profile?:Vec2[];path?:Vec3[];outline?:Vec2[];radius?:number;depth?:number;}
export interface Repeat {count:number;layout:'none'|'ring'|'phyllotaxis'|'line';radius:number;axis:'x'|'y'|'z';step:Vec3;startAngle:number;arc:number;orient:boolean;}
export interface Part {id:string;name:string;officialName:string;category:string;shape:string;color:string;pos:Vec3;scale?:Vec3;rotation?:Vec3;nodes?:GeometryNode[];material:string;description:string;purpose:string;facts:string[];certainty:'observed'|'typical'|'estimated';sources:Source[];canExplore:boolean;repeat?:Repeat;}
export interface Origin {title:string;kind:'point'|'region'|'unknown';lat:number;lon:number;radiusMiles:number;place:string;hint:string;claim:string;explanation:string;facts:string[];sources:Source[];}
export interface Specimen {id:string;name:string;officialName:string;family:string;parts:Part[];note:string;assumptions:string[];origin:Origin;sources:Source[];searchSuggestions?:string;parent?:string;}
export interface Candidate {id:string;label:string;officialName:string;confidence:number;kind:'object'|'food'|'human'|'animal'|'plant';scope:string;box:[number,number,number,number];}
export interface Session {key:string;model:string;configured:boolean;}
export function categoryColor(index:number){return ['#557aab','#a67d48','#538966','#bd6654','#8b6ca6','#ad944e','#6198a6'][index%7]}
