const assert=require('node:assert/strict');
const {test}=require('node:test');
const React=require('react');
const {create,act}=require('react-test-renderer');
require('./register-typescript.cjs');
const Copy=require('../src/app/components/results/CopySimcInputButton.tsx').default;
for(const fails of [false,true])test(fails?'failed input fetch cannot report success':'copies saved run input with Safari-compatible clipboard timing',async()=>{
 const fetchBefore=global.fetch, navBefore=Object.getOwnPropertyDescriptor(global,'navigator'),itemBefore=global.ClipboardItem;
 const events=[];let view,copied;
 try{
  global.fetch=async url=>{assert.ok(url.endsWith('/api/sim/saved%2Frun/input'));events.push('fetch');return {ok:!fails,text:async()=>{events.push('text');return 'shaman="Saved"\n';}}};
  global.ClipboardItem=class{constructor(data){this.data=data;}};
  Object.defineProperty(global,'navigator',{configurable:true,value:{clipboard:{write:async items=>{events.push('write');copied=await (await items[0].data['text/plain']).text();}}}});
  act(()=>{view=create(React.createElement(Copy,{jobId:'saved/run'}));});
  await act(async()=>{await view.root.findByType('button').props.onClick();});
  if(fails){assert.equal(copied,undefined);assert.ok(view.root.findByProps({role:'alert'}));}
  else{assert.equal(copied,'shaman="Saved"\n');assert.ok(events.indexOf('write')<events.indexOf('text'));assert.equal(view.root.findByType('button').props['aria-label'],'SimC input copied');}
 }finally{
  if(view)act(()=>view.unmount());global.fetch=fetchBefore;global.ClipboardItem=itemBefore;
  if(navBefore)Object.defineProperty(global,'navigator',navBefore);else delete global.navigator;
 }
});
