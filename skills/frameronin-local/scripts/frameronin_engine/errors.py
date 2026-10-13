"""可对外报告的领域错误；不暴露凭据或完整子进程日志。"""


class RoninError(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}

    def record(self):
        return {'code': self.code, 'message': self.message, 'details': self.details}


class Cancelled(RoninError):
    def __init__(self):
        super().__init__('TASK_CANCELED', 'The task was canceled; its late results cannot be accepted.')
