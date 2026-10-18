import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
const here=path.dirname(fileURLToPath(import.meta.url)),skill=path.resolve(here,'../..'),workbench=path.join(skill,'assets/workbench'),output=path.join(skill,'.runtime/capture-ui')
await fs.mkdir(output,{recursive:true});await fs.cp(path.join(skill,'assets/fixtures/video-capture'),path.join(output,'video-capture'),{recursive:true})
const video=spawnSync('ffmpeg',['-nostdin','-v','error','-y','-stream_loop','-1','-i',path.join(output,'video-capture/h264.mp4'),'-t','30','-c','copy',path.join(output,'cancel-long.mp4')],{encoding:'utf8'})
if(video.status!==0)throw new Error(`Cancellation fixture failed: ${video.stderr}`)
const config=path.join(skill,'.runtime/capture-ui-vite.config.mjs')
await fs.writeFile(config,`import base from ${JSON.stringify(path.join(workbench,'vite.config.ts'))};export default {...base,base:'/acceptance/',root:${JSON.stringify(path.join(skill,'tests'))},publicDir:false,plugins:base.plugins.filter(p=>p.name!=='copy-404'),build:{outDir:${JSON.stringify(output)},emptyOutDir:false,rollupOptions:{input:${JSON.stringify(path.join(skill,'tests/managed-capture.html'))}}}};`)
const result=spawnSync(process.execPath,[path.join(workbench,'node_modules/vite/bin/vite.js'),'build','--config',config],{cwd:workbench,stdio:'inherit'})
if(result.status!==0)throw new Error(`Managed capture page build failed: ${result.status}`)
process.stdout.write(JSON.stringify({output})+'\n')
