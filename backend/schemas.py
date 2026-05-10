from pydantic import BaseModel
from pydantic import Field
from typing import Optional


class TestConfigCreate(BaseModel):
    name: str
    description: Optional[str] = None
    type: str  # 'thermal', 'vision', or 'custom'
    parameters: dict[str, str] = Field(default_factory=dict)


class TestConfigResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    type: str
    created_at: str
    parameters: dict[str, str] = Field(default_factory=dict)


class TestRunResponse(BaseModel):
    id: int
    test_config_id: int
    start_time: str
    end_time: Optional[str]
    status: str
    failure_reason: Optional[str]


class TestRunRequest(BaseModel):
    duration: Optional[int] = None  # seconds; None means manual-only termination


class TestRunStartResponse(BaseModel):
    run_id: int
    status: str


class TestReplayResponse(BaseModel):
    run_id: int
    available: bool
    artifact: Optional[dict] = None
    frames: list[dict] = Field(default_factory=list)
    events: list[dict] = Field(default_factory=list)