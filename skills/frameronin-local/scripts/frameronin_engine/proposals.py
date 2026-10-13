"""Revisioned AI proposals. Saving and previewing never execute an operation."""
import json
from .errors import RoninError
from .operations import preview
from .project import checked_id, identifier, now


def _revision(value):
    if type(value) is not int or value < 0:
        raise RoninError('PROPOSAL_REVISION_INVALID', 'Proposal revisions must be non-negative integers.')


def get(project, proposal_id):
    checked_id(proposal_id)
    with project.connection() as database:
        row = database.execute('SELECT * FROM proposals WHERE id=?', (proposal_id,)).fetchone()
    if not row:
        raise RoninError('PROPOSAL_MISSING', 'The proposal does not exist.')
    result = dict(row)
    result['payload'] = json.loads(result['payload'])
    return result


def save(project, request, selected_versions, proposal_id=None, expected_revision=0):
    _revision(expected_revision)
    if not isinstance(request, dict) or request.get('operation') == 'workflow.legacy':
        raise RoninError('PROPOSAL_OPERATION_INVALID', 'AI proposals use strict operations. Import historical blueprints separately.')
    if not isinstance(selected_versions, list) or not 1 <= len(selected_versions) <= 1000 or not all(isinstance(value, str) for value in selected_versions):
        raise RoninError('PROPOSAL_SELECTION_REQUIRED', 'Provide the versions explicitly selected for this proposal separately from its model-generated JSON.')
    allowed = {checked_id(version) for version in selected_versions}
    inputs = request.get('inputs')
    if not isinstance(inputs, list) or not all(isinstance(value, str) for value in inputs) or not set(inputs) <= allowed:
        raise RoninError('PROPOSAL_INPUT_NOT_SELECTED', 'The proposal may only process explicitly selected versions.')
    details = preview(project, request)
    if details['assetId'] and details['assetId'] not in {version['asset_id'] for version in details['versions']}:
        raise RoninError('PROPOSAL_OUTPUT_NOT_SELECTED', 'A proposal can append only to its selected input assets, or create a new result asset.')
    proposal_id = checked_id(proposal_id) if proposal_id else identifier()
    normalized = {key:details[key] for key in ['operation','inputs','parameters']}
    if details['assetId']: normalized['assetId'] = details['assetId']
    with project.writer(), project.connection() as database:
        current = database.execute('SELECT revision FROM proposals WHERE id=?', (proposal_id,)).fetchone()
        if (current['revision'] if current else 0) != expected_revision:
            raise RoninError('PROPOSAL_REVISION_CHANGED', 'Preview the current proposal revision before executing it.')
        inputs = []
        for version in details['versions']:
            asset = database.execute('SELECT current_version FROM assets WHERE id=?', (version['asset_id'],)).fetchone()
            inputs.append({'id':version['id'],'sha256':version['sha256'],'assetId':version['asset_id'],'head':asset['current_version']})
        envelope = {'formatVersion':1,'request':normalized,'preview':{key:value for key,value in details.items() if key not in ['versions']},
                    'inputSnapshot':inputs,'selectedVersions':selected_versions,'executionTask':None}
        if details['assetId']:
            envelope['outputAssetHead'] = database.execute('SELECT current_version FROM assets WHERE id=?', (details['assetId'],)).fetchone()[0]
        database.execute('INSERT OR REPLACE INTO proposals VALUES(?,?,?,?)',
                         (proposal_id, expected_revision + 1, json.dumps(envelope,allow_nan=False), now()))
    return get(project, proposal_id)


def execute(project, proposal_id, revision):
    _revision(revision)
    proposal = get(project, proposal_id)
    if proposal['revision'] != revision:
        raise RoninError('PROPOSAL_REVISION_CHANGED', 'Preview the current proposal revision before executing it.')
    envelope = proposal['payload']
    details = preview(project, envelope['request'])
    checksums = {version['id']:version['sha256'] for version in details['versions']}
    def claim(database, task_id):
        current = database.execute('SELECT * FROM proposals WHERE id=?', (proposal_id,)).fetchone()
        if not current or current['revision'] != revision or current['payload'] != json.dumps(envelope,allow_nan=False):
            raise RoninError('PROPOSAL_REVISION_CHANGED', 'The proposal changed during execution validation.')
        if envelope['executionTask']:
            raise RoninError('PROPOSAL_ALREADY_EXECUTED', 'This proposal revision already has a task. Inspect that task before executing another revision.')
        for version in envelope['inputSnapshot']:
            asset = database.execute('SELECT current_version FROM assets WHERE id=?', (version['assetId'],)).fetchone()
            if not asset or asset['current_version'] != version['head'] or checksums.get(version['id']) != version['sha256']:
                raise RoninError('PROPOSAL_INPUT_CHANGED', 'A selected input changed after preview. Create and review a new proposal revision.')
        if envelope.get('outputAssetHead'):
            target = database.execute('SELECT current_version FROM assets WHERE id=?', (envelope['request']['assetId'],)).fetchone()
            if not target or target[0] != envelope['outputAssetHead']:
                raise RoninError('PROPOSAL_INPUT_CHANGED', 'The output asset changed after preview. Review a new proposal revision.')
        accepted = dict(envelope, executionTask=task_id)
        database.execute('UPDATE proposals SET payload=? WHERE id=? AND revision=?', (json.dumps(accepted,allow_nan=False),proposal_id,revision))
    from .tasks import submit
    return submit(project, envelope['request'], precommit=claim)
