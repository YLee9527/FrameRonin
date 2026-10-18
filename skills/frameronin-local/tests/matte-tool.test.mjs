import test from 'node:test'
import assert from 'node:assert/strict'
import {validateMatteToolLayout,checkMatteToolBudget} from '../.runtime/js/algorithms.mjs'

const chroma={mode:'chroma',keyColor:'#00ff00',tolerance:35,smoothness:34,spill:75,erosion:77}
const double={mode:'doubleBg',tolerance:70,edgeContrast:53},source={width:43,height:37,bytes:4096},budget=2*1024**3
test('standalone matte recipes reject unknown or unused fields, malformed values and out-of-range controls',()=>{
 for(const p of [chroma,double,{mode:'whiteErode',tolerance:5,smoothness:100,erosion:0},{mode:'repair'},{mode:'frontier',erosion:14.9}])validateMatteToolLayout(p)
 for(const p of [null,[],{mode:'unknown'},{...chroma,command:'run'},{...chroma,keyColor:'#fff'},{...chroma,keyColor:34},{...chroma,spill:true},{...chroma,tolerance:Infinity},{...chroma,smoothness:4.9},{...chroma,erosion:101},{...double,edgeContrast:NaN},{...double,tolerance:49},{mode:'repair',erosion:0},{mode:'whiteErode',tolerance:35,smoothness:34,erosion:77,spill:75}])assert.throws(()=>validateMatteToolLayout(p),/MATTE_TOOL_/)
})
test('matte resource preflight counts both full decodes, all intermediate buffers and retained frontend memory',()=>{
 assert.equal(checkMatteToolBudget([source],chroma,budget,0),256*1024**2+43*37*192+4096*12)
 assert.equal(checkMatteToolBudget([source,source],double,budget,100),256*1024**2+2*(43*37*192+4096*12)+100)
 for(const [sources,p,limit,retained] of [[[source],double,budget,0],[[source,source],chroma,budget,0],[[source,{...source,width:42}],double,budget,0],[[{...source,width:8192,height:8192}],chroma,budget,0],[[source],chroma,budget,budget],[[source],chroma,budget,NaN],[[source],chroma,0,0],[[{...source,width:true}],chroma,budget,0],[[{...source,bytes:21*1024**2}],chroma,budget,0]])assert.throws(()=>checkMatteToolBudget(sources,p,limit,retained),/MATTE_TOOL_/)
 assert(checkMatteToolBudget([{...source,bytes:24*1024**2}],{mode:'repair'},budget,0)<budget)
 assert.throws(()=>checkMatteToolBudget([{...source,bytes:129*1024**2}],{mode:'frontier',erosion:1},budget,0),/SOURCE/)
})
