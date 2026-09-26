import {authorize,chooseModel,keyFor,respondError} from '@/lib/explode/gemini-server';
export async function POST(request:Request){try{await authorize(request);const model=await chooseModel(keyFor(request),request.signal);return Response.json({model},{headers:{'Cache-Control':'no-store'}})}catch(e){return respondError(e)}}
