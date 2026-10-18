"""Owned same-origin acceptance page using unmodified production task endpoints."""
import argparse
from pathlib import Path
import sys
import uvicorn
from fastapi.staticfiles import StaticFiles
from starlette.routing import Mount
SKILL=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(SKILL/'scripts'))
from frameronin_engine.project import Project
from frameronin_engine.server import application
parser=argparse.ArgumentParser();parser.add_argument('--project',required=True);parser.add_argument('--port',type=int,default=8779);args=parser.parse_args()
if not 1024<=args.port<=65535:parser.error('Choose an unprivileged loopback port.')
project=Project(args.project)
with project.connection() as db:
    if db.execute("SELECT 1 FROM tasks WHERE state IN ('queued','running') LIMIT 1").fetchone():parser.error('Start with an idle owned acceptance project.')
app=application(project,args.port)
app.router.routes.insert(0,Mount('/acceptance',app=StaticFiles(directory=SKILL/'.runtime/capture-ui')))
uvicorn.run(app,host='127.0.0.1',port=args.port,log_level='warning')
