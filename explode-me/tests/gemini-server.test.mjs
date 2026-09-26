import assert from 'node:assert/strict';
import {test,beforeEach,afterEach} from 'node:test';
const originalKey=process.env.GEMINI_API_KEY;
const originalOrigin=process.env.APP_ORIGIN;
beforeEach(()=>{delete process.env.GEMINI_API_KEY;delete process.env.APP_ORIGIN});
afterEach(()=>{if(originalKey===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=originalKey;if(originalOrigin===undefined)delete process.env.APP_ORIGIN;else process.env.APP_ORIGIN=originalOrigin});
const {POST}=await import('../app/api/explode/connect/route.ts');
const model='gemini-2.5-flash';
const longKey='AQ.'+'aB9_-'.repeat(250)+'.synthetic-key';
const request=key=>new Request('https://example.test/api/explode/connect',{
 method:'POST',headers:key===undefined?{}:{'x-gemini-api-key':key}
});
function mockGoogle(t,status=200){
 return t.mock.method(globalThis,'fetch',async()=>Response.json(
  status===200?{models:[{name:'models/'+model,supportedGenerationMethods:['generateContent']}]}:{error:{message:'Rejected'}},
  {status}
 ));
}

for(const [name,key] of [
 ['legacy key','AIza'+'a'.repeat(35)],
 ['dotted AQ. key','AQ.synthetic.key'],
 ['AQ. key longer than 200 characters',longKey],
 ['opaque key format','future-format'],
])test('connect forwards '+name+' unchanged to Google',async t=>{
 const fetchMock=mockGoogle(t);
 const response=await POST(request(key));
 assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{model});
 assert.equal(fetchMock.mock.callCount(),1);
 const [url,options]=fetchMock.mock.calls[0].arguments;
 assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
 assert.equal(options.headers['x-goog-api-key'],key);
});

test('missing and blank keys are rejected before contacting Google',async t=>{
 const fetchMock=mockGoogle(t);
 for(const key of [undefined,'','   ']){
  const response=await POST(request(key));
  assert.equal(response.status,428);
  assert.match((await response.json()).error,/Connect your Gemini API key/);
 }
 assert.equal(fetchMock.mock.callCount(),0);
});

test('server key is used when no client key is supplied and is trimmed',async t=>{
 const fetchMock=mockGoogle(t);
 process.env.GEMINI_API_KEY='  '+longKey+'  ';
 t.after(()=>{delete process.env.GEMINI_API_KEY});
 const response=await POST(request(undefined));
 assert.equal(response.status,200);
 assert.equal(fetchMock.mock.calls[0].arguments[1].headers['x-goog-api-key'],longKey);
});

test('Google rejection of a long AQ. key reaches the existing error handler',async t=>{
 const fetchMock=mockGoogle(t,403);
 const response=await POST(request(longKey));
 assert.equal(fetchMock.mock.callCount(),1);
 assert.equal(response.status,502);
 assert.deepEqual(await response.json(),{error:'Gemini rejected this key. Check its API access and restrictions.'});
});


test('a replacement client key overrides the server key',async t=>{
 const fetchMock=mockGoogle(t);
 process.env.GEMINI_API_KEY='different-server-key';
 const response=await POST(request(longKey));
 assert.equal(response.status,200);
 assert.equal(fetchMock.mock.calls[0].arguments[1].headers['x-goog-api-key'],longKey);
});

test('cross-origin connection requests are rejected before Google',async t=>{
 const fetchMock=mockGoogle(t);
 const req=request(longKey);req.headers.set('origin','https://other.example');
 assert.equal((await POST(req)).status,403);
 assert.equal(fetchMock.mock.callCount(),0);
});
