import {readFileSync} from 'node:fs';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
registerHooks({
 resolve(specifier,context,nextResolve){
  if(specifier.startsWith('@/'))return nextResolve(new URL('../'+specifier.slice(2)+'.ts',import.meta.url).href,context);
  try{return nextResolve(specifier,context)}catch(error){
   if(error.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.'))return nextResolve(specifier+'.ts',context);
   throw error;
  }
 },
 load(url,context,nextLoad){
  if(url.endsWith('.ts'))return {format:'module',source:stripTypeScriptTypes(readFileSync(new URL(url),'utf8'),{mode:'transform'}),shortCircuit:true};
  return nextLoad(url,context);
 }
});
