"""
backend/api/routes_configs.py

CRUD routes for test configurations.
  POST   /api/configs              — create a config
  GET    /api/configs              — list all configs
  GET    /api/configs/{config_id}  — get a single config
  PUT    /api/configs/{config_id}  — update a config
  DELETE /api/configs/{config_id}  — delete a config
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException

from backend.database.database import (
    create_test_config,
    delete_test_config,
    get_all_configs,
    get_config_by_id,
    get_test_parameters,
    insert_test_parameter,
    update_test_config,
)
from backend.schemas import TestConfigCreate, TestConfigResponse

router = APIRouter(prefix="/api/configs", tags=["configs"])


@router.post("", response_model=TestConfigResponse)
def create_config(config: TestConfigCreate):
    config_id = create_test_config(config.name, config.description, config.type)
    for key, value in config.parameters.items():
        insert_test_parameter(config_id, key, value)
    return {
        **config.model_dump(),
        "id": config_id,
        "created_at": datetime.now().isoformat(),
    }


@router.get("", response_model=list[TestConfigResponse])
def list_configs():
    rows = get_all_configs()
    return [
        {**dict(row), "parameters": get_test_parameters(row["id"])}
        for row in rows
    ]


@router.get("/{config_id}", response_model=TestConfigResponse)
def get_config(config_id: int):
    row = get_config_by_id(config_id)
    if not row:
        raise HTTPException(status_code=404, detail="Config not found")
    return {**dict(row), "parameters": get_test_parameters(config_id)}


@router.put("/{config_id}")
def update_config(config_id: int, config: TestConfigCreate):
    if not get_config_by_id(config_id):
        raise HTTPException(status_code=404, detail="Config not found")
    update_test_config(config_id, config.name, config.description, config.type)
    return {"ok": True}


@router.delete("/{config_id}")
def delete_config(config_id: int):
    if not get_config_by_id(config_id):
        raise HTTPException(status_code=404, detail="Config not found")
    delete_test_config(config_id)
    return {"ok": True}