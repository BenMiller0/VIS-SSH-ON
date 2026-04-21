from pydantic import BaseModel
from typing import Optional


class TestConfigCreate(BaseModel):
    name: str
    description: Optional[str] = None
    type: str  # 'thermal' or 'custom'
    parameters: dict[str, str] = {}


class TestConfigResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    type: str
    created_at: str
    parameters: dict[str, str] = {}


class TestRunResponse(BaseModel):
    id: int
    test_config_id: int
    start_time: str
    end_time: Optional[str]
    status: str
    failure_reason: Optional[str]