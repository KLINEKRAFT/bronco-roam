#!/usr/bin/env node
/* Campaign integration checks with the real inline game and physics.
   DOM/WebGL calls are stubbed: these are logic checks, not visual/browser QA.
   Run: node tools/verify-adventure.mjs */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(source);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length,new Set(ids).size,'DOM IDs must be unique');
const gl=new Proxy({}, {get(t,k){
  if(k==='getShaderParameter')return ()=>true;
  if(k==='getProgramParameter')return (_,p)=>p==='LINK_STATUS'?true:0;
  if(k==='checkFramebufferStatus')return ()=>'FRAMEBUFFER_COMPLETE';
  if(k.startsWith('create'))return ()=>({});
  if(k.toUpperCase()===k)return k;
  return ()=>{};
}});
const ctx2d=new Proxy({}, {get(){return ()=>{};},set(){return true;}});
const noop=()=>{};
const elements=new Map();
function element(id){
  if(!elements.has(id))elements.set(id,{id,style:{},classList:{add:noop,remove:noop,toggle:noop},hidden:false,disabled:false,open:false,
    textContent:'',innerHTML:'',clientWidth:240,clientHeight:100,width:900,height:600,
    addEventListener:noop,setAttribute:noop,focus:noop,getBoundingClientRect:()=>({left:0,top:0,width:100,height:40,right:100,bottom:40}),
    querySelector:()=>element(id+'-child'),get firstElementChild(){return element(id+'-child');},
    getContext:type=>type==='webgl2'?gl:ctx2d,showModal(){this.open=true;},close(){this.open=false;}});
  return elements.get(id);
}
let saved=null,failStorage=false;
const document={getElementById:id=>{assert(ids.includes(id),'Missing DOM element '+id);return element(id);},
  hidden:false,body:element('body'),querySelectorAll:()=>[],addEventListener:noop};
const sandbox={console,document,innerWidth:1280,innerHeight:800,devicePixelRatio:1,navigator:{},screen:{orientation:{angle:0}},
  addEventListener:noop,removeEventListener:noop,requestAnimationFrame:noop,setTimeout:noop,performance:{now:()=>1000},
  atob:s=>Buffer.from(s,'base64').toString('binary'),localStorage:{getItem:()=>saved,setItem:(_,v)=>{if(failStorage)throw Error('unavailable');saved=v;}},
  Uint8Array,Float32Array,Uint16Array,Uint32Array,Int16Array,Int8Array,DataView,ArrayBuffer,Map,Set,Math,JSON,Number,String,Object,Error};
sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(source,sandbox,{timeout:20000});
const run=code=>vm.runInContext(code,sandbox,{timeout:20000});
run('booting=false;coverBlend=0;car.contacts=4;vset(car.v,0,0,0);');
const state=()=>JSON.parse(run('JSON.stringify(journey)'));
function atTarget(){run('constTarget=currentLeg();car.p.x=constTarget.x;car.p.z=constTarget.z;car.p.y=heightAt(car.p.x,car.p.z)+1;vset(car.v,0,0,0);car.contacts=4;');}
run('var constTarget;');
assert.equal(state().mission,0);
run('car.p.x=9999;interactJourney();');assert.equal(run('adventure.service'),0,'cannot interact remotely');
atTarget();run('car.v.z=10;interactJourney();');assert.equal(run('adventure.service'),0,'must stop to interact');
run('car.v.z=0;interactJourney();');assert(run('adventure.service')>0);
run('updateJourney(1);');assert.equal(state().mission,0,'service takes time');
run('setJournal(true);updateJourney(20);');assert.equal(state().mission,0,'journal pauses service');
run('setJournal(false);updateJourney(5);');assert.equal(state().mission,1);assert.equal(state().credits,120);
run('buyUpgrade("engine");');assert.equal(state().upgrades.length,0,'insufficient credits');
while(state().mission<5){
  atTarget();run('interactJourney();updateJourney(6);');
}
assert.equal(state().mission,5);
assert.equal(state().credits,1030,'five mission rewards plus clean cargo bonus');
run('buyUpgrade("engine");buyUpgrade("engine");');assert.equal(state().credits,870,'only charge once');
assert.equal(run('CARP.engine'),24724.999999999996);
run('recoverJourney();');assert.equal(state().leg,0);assert.equal(run('adventure.time'),null);
atTarget();run('interactJourney();');assert.equal(state().leg,1);assert.equal(run('adventure.time'),0);
run('setJournal(true);updateJourney(50);');assert.equal(run('adventure.time'),0,'journal pauses race');run('setJournal(false);');
run('car.p.x=9999;updateJourney(151);');assert.equal(state().leg,0,'timeout resets race');assert.equal(run('adventure.time'),null);
atTarget();run('interactJourney();');
run('car.p.x=RALLY_GATES[3].x;car.p.z=RALLY_GATES[3].z;car.p.y=heightAt(car.p.x,car.p.z)+1;updateJourney(1);');assert.equal(state().leg,1,'out of order gate does not count');
while(state().mission===5){atTarget();run('updateJourney(10);');}
assert.equal(state().mission,6,'campaign reaches ending');assert.equal(state().best,41);assert.equal(run('adventure.open'),true,'ending opens journal');
const balance=state().credits;
run('setJournal(false);journey.mission=5;journey.leg=0;recoverJourney();');atTarget();run('interactJourney();');
run('saveJourney();');assert.equal(run('loadJourney().leg'),0,'reload restarts an active rally');
while(state().mission===5){atTarget();run('updateJourney(8);');}
assert.equal(state().best,32);assert.equal(state().credits,balance+100,'repeat reward is bounded');
run('setJournal(false);car.p.x=TRAIL_STAMPS[4].x;car.p.z=TRAIL_STAMPS[4].z;car.p.y=heightAt(car.p.x,car.p.z)+1;updateJourney(1);');
const stampBalance=state().credits;run('updateJourney(1);');assert.equal(state().credits,stampBalance,'stamps cannot be farmed');
run('saveJourney();');assert.equal(JSON.parse(saved).mission,6);
saved='{broken json';assert.equal(run('loadJourney().mission'),0,'corrupt saves recover');
saved=JSON.stringify({version:1,mission:99});assert.equal(run('loadJourney().mission'),0,'invalid mission rejected');
failStorage=true;run('saveJourney();');assert.equal(run('adventure.saveFailed'),true,'blocked storage does not crash');
run('input.gas=1;keys.KeyW=1;clearDriving();');assert.equal(run('input.gas'),0);assert.equal(run('keys.KeyW'),0);
// Exercise both driver palettes and marker creation with the real packed meshes.
run('poseCharacter(CHAR.byName.Idle,0,-1,0,true);');assert(run('[...charGL.palette].every(Number.isFinite)'),'seated skin matrices are finite');
run('poseCharacter(CHAR.byName.Idle,0,-1,0);drawMichaelDriving();drawTrailMarkers();renderJourneyHUD();projectJourneyMarker();');
// The rally has to be physically possible, not just a set of reachable coordinates.
run('journey.mission=5;journey.leg=0;recoverJourney();car.q=qid();carStep(PH);');
run('frame(1016);');
const rally = JSON.parse(run(`JSON.stringify((()=>{
  journey.upgrades=[];applyUpgrades();
  car.p.x=rallyStart.x;car.p.z=rallyStart.z;resetCar(false);repairCar();car.q=qid();
  car.throttle=0;car.brake=0;car.hand=1;
  for(let i=0;i<240;i++)carStep(PH);
  let gate=0,t=0;
  while(t<150 && gate<RALLY_GATES.length){
    const speed=vlen(car.v),look=30+speed*0.8,z=car.p.z+look;
    let error=Math.atan2(roadCenterX(z)-car.p.x,z-car.p.z)-Math.atan2(car.fwd.x,car.fwd.z);
    while(error>Math.PI)error-=2*Math.PI;while(error < -Math.PI)error+=2*Math.PI;
    car.steerInput=clamp(-error*2,-1,1);car.throttle=speed<25?0.8:0;car.brake=speed>27?0.3:0;car.hand=0;
    carStep(PH);t+=PH;
    const p=RALLY_GATES[gate];if(Math.hypot(car.p.x-p.x,car.p.z-p.z)<32)gate++;
  }
  return {gates:gate,seconds:t,x:car.p.x,z:car.p.z};
})())`));
assert.equal(rally.gates,4,'real physics can finish the rally inside 150 seconds: '+JSON.stringify(rally));
console.log('Rally route completed with real physics in '+rally.seconds.toFixed(1)+' seconds.');
console.log('PASS: boot integration, service gating, full campaign, rewards, upgrades, race ordering/timeout/replay, pause, save recovery, input release, driver matrices and frame integration.');
