"""Owned loopback acceptance server for deterministic cancellation/restore races.

Flags in --gates: delay-upload, delay-content, delay-worker. Removing a flag
restores the normal path. No production endpoint or test-only switch is added.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys
import uvicorn

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'scripts'))
from frameronin_engine.project import Project
from frameronin_engine.server import application

parser=argparse.ArgumentParser()
parser.add_argument('--project',required=True)
parser.add_argument('--gates',required=True)
parser.add_argument('--port',type=int,default=8769)
parser.add_argument('--delay',type=float,default=2)
args=parser.parse_args()
if not 1024<=args.port<=65535 or not 0<args.delay<=5:parser.error('Use a local unprivileged port and a delay up to five seconds.')
project=Project(args.project);gates=Path(args.gates).resolve();gates.mkdir(parents=True,exist_ok=True)
with project.connection() as db:
    if db.execute("SELECT 1 FROM tasks WHERE state IN ('queued','running') LIMIT 1").fetchone():parser.error('Start with an idle, owned acceptance project.')
app=application(project,args.port)

@app.middleware('http')
async def delayed(request,call_next):
    path=request.url.path
    host_worker=any(name in path for name in ['/normalImage.worker-','/matteTool.worker-','/expandShrink.worker-','/scatterSlice.worker-','/customSlice.worker-','/geminiWatermark.worker-','/spriteGifRows.worker-','/spriteSheetAssets.worker-','/sheetAdjust.worker-','/sheetAdjustPreview.worker-','/sheetPrepare.worker-','/videoAssets.worker-','/videoFrames.worker-','/videoCapture.worker-']) and path.endswith('.js')
    flag='delay-upload' if path.endswith('/browser/result') else 'delay-content' if path.startswith('/api/versions/') and path.endswith('/content') else 'delay-worker' if host_worker else None
    if flag and (gates/flag).is_file():await asyncio.sleep(args.delay)
    response=await call_next(request)
    if host_worker or path.startswith('/api/versions/') and path.endswith('/content'):
        response.headers['Cache-Control']='no-store'
    return response

print(json.dumps({'url':f'http://127.0.0.1:{args.port}','delaySeconds':args.delay}),flush=True)
uvicorn.run(app,host='127.0.0.1',port=args.port,log_level='warning')
