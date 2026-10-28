const assert = require('node:assert/strict');
const {test} = require('node:test');
require('./register-typescript.cjs');
const {scenarioKey,groupRuns,rotationLabel,gainVsEquipped}=require('../src/app/lib/runLibrary.ts');
const job=(id,extra={})=>({id,fight_style:'Patchwerk',scenario:{targets:1,duration:300,variation:null,rotation:'default',settings:{},...extra}});
test('groups distinguish targets, rotation, duration, buffs, variation and revision',()=>{
 const jobs=[job('a'),job('b'),job('c',{targets:10}),job('d',{rotation:'assisted_combat'}),job('e',{duration:180}),job('f',{settings:{bloodlust:false}}),job('g',{variation:0.2}),job('h',{simc_revision:'new'})];
 const groups=groupRuns(jobs,true);
 assert.equal(groups.length,7);assert.deepEqual(groups[0].jobs.map(j=>j.id),['a','b']);
 assert.equal(groupRuns(jobs,false).length,1);
});
test('canonical settings are independent of property order; precision is not scenario identity',()=>{
 const a=job('a',{settings:{a:1,b:{x:1,y:2}}});
 const b=job('b',{settings:{b:{y:2,x:1},a:1},target_error:0.05,baseline_dps:100});
 assert.equal(scenarioKey(a),scenarioKey(b));
 assert.equal(rotationLabel('assisted_combat'),'Assisted Combat');
});
test('gain only compares achieved precise scores against a qualified baseline',()=>{
 const j={...job('a',{baseline_dps:100,baseline_error_pct:0.1,target_error:0.1}),precise_dps:105};
 assert.ok(Math.abs(gainVsEquipped(j)-5)<0.00001);
 assert.equal(gainVsEquipped({...j,precise_dps:null}),null);
 assert.equal(gainVsEquipped({...j,scenario:{...j.scenario,baseline_error_pct:2}}),null);
});

test('default empty options do not split groups, but food differences stay visible',()=>{
 const {scenarioDifferences}=require('../src/app/lib/runLibrary.ts');
 const a=job('a',{settings:{consumables:{food:{name:'Food A',value:'a'}}}});
 const b=job('b',{settings:{simc_branch:'',consumables:{food:{name:'Food A',value:'a'}}}});
 const c=job('c',{settings:{consumables:{food:{name:'Food B',value:'b'}}}});
 assert.equal(scenarioKey(a),scenarioKey(b));
 assert.equal(scenarioDifferences(a,[a,b,c]),'Food: Food A');
});

test('large environment differences produce short summaries without raw override syntax',()=>{
 const {scenarioDifferences}=require('../src/app/lib/runLibrary.ts');
 const a=job('a',{settings:{raid_buffs:{bloodlust:true,skyfury:true},consumables:{flask:{name:'Flask'},potion:{name:'Potion'},food:{name:'Food'}}}});
 const b=job('b',{settings:{raid_buffs:{bloodlust:false,skyfury:false},consumables:{flask:null,potion:null,food:null}}});
 assert.equal(scenarioDifferences(a,[a,b]),'2 buffs on · 3 consumables on');
 assert.equal(scenarioDifferences(b,[a,b]),'0 buffs on · 2 off · Consumables off');
});

test('revision remains available without a branch and does not consume difference summary space',()=>{
 const {scenarioDifferences}=require('../src/app/lib/runLibrary.ts');
 const a=job('a',{simc_revision:'3ca15de'});
 const b=job('b',{simc_revision:'6a4500d',settings:{simc_branch:'nightly'}});
 assert.notEqual(scenarioKey(a),scenarioKey(b));
 assert.equal(scenarioDifferences(a,[a,b]),'Simc branch: Not recorded');

});
