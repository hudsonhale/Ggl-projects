import {authorize,respondError,serverConfigured} from '@/lib/explode/gemini-server';
export async function GET(request:Request){try{await authorize(request);return Response.json({configured:serverConfigured()},{headers:{'Cache-Control':'no-store'}})}catch(e){return respondError(e)}}
